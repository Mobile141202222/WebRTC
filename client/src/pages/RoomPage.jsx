import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import AudioStreamRack from '../components/AudioStreamRack.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import ParticipantsPanel from '../components/ParticipantsPanel.jsx';
import RoomConsole from '../components/RoomConsole.jsx';
import RoomHeader from '../components/RoomHeader.jsx';
import { useCleanupHook } from '../hooks/CleanupHook.js';
import { getFirebaseConfigError, isFirebaseReady } from '../lib/firebase.js';
import { createParticipantId } from '../lib/roomId.js';
import { sanitizeDisplayName, sanitizeRoomId } from '../lib/sanitize.js';
import { ChatProvider } from '../providers/ChatProvider.jsx';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  subscribeToParticipants,
  subscribeToRoom,
  updateParticipantState,
} from '../services/RoomManager.js';
import { VoiceEngine } from '../services/VoiceEngine.js';

const STORAGE_KEY = 'ephemeral-chat-display-name';

function RoomPage({ onToggleTheme, theme }) {
  const navigate = useNavigate();
  const { roomId: routeRoomId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const participantIdRef = useRef(createParticipantId());
  const voiceEngineRef = useRef(null);

  const roomId = sanitizeRoomId(routeRoomId);
  const requestedMediaMode = searchParams.get('mode') === 'video' ? 'video' : 'voice';
  const isHost = searchParams.get('host') === '1';

  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem(STORAGE_KEY) || '',
  );
  const [nameDraft, setNameDraft] = useState(displayName);
  const [copyState, setCopyState] = useState('Copy');
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [isBooting, setIsBooting] = useState(true);
  const [isJoinedRoom, setIsJoinedRoom] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraAvailable, setCameraAvailable] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(requestedMediaMode === 'video');
  const [participants, setParticipants] = useState([]);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [localStream, setLocalStream] = useState(null);
  const [roomEnded, setRoomEnded] = useState(false);
  const [selfPeerId, setSelfPeerId] = useState('');
  const [roomMediaMode, setRoomMediaMode] = useState(requestedMediaMode);
  const [voiceStatus, setVoiceStatus] = useState('Connecting...');

  const inviteLink = `${window.location.origin}/room/${roomId}`;
  const selfParticipant = {
    id: participantIdRef.current,
    isHost,
    name: displayName,
    peerId: selfPeerId,
    audioEnabled: Boolean(localStream) && !muted,
    videoEnabled: cameraEnabled,
  };

  const onRemoteStream = useEffectEvent(({ participantId, stream }) => {
    setRemoteStreams((currentStreams) => [
      ...currentStreams.filter((entry) => entry.participantId !== participantId),
      { participantId, stream },
    ]);
  });

  const onRemoteDisconnect = useEffectEvent((participantId) => {
    setRemoteStreams((currentStreams) =>
      currentStreams.filter((entry) => entry.participantId !== participantId),
    );
  });

  const onLocalStream = useEffectEvent((stream) => {
    setLocalStream(stream);
  });

  const onVoiceError = useEffectEvent((voiceError) => {
    const nextMessage = voiceError?.message || 'Media unavailable';
    setVoiceStatus(nextMessage);
  });

  useEffect(() => {
    if (!roomId) {
      setError('Room code ไม่ถูกต้อง');
      setIsBooting(false);
      return undefined;
    }

    if (!displayName || !isFirebaseReady()) {
      setIsBooting(false);
      return undefined;
    }

    let active = true;
    const voiceEngine = new VoiceEngine({
      onError: onVoiceError,
      onLocalStream,
      onRemoteDisconnect,
      onRemoteStream,
      onStatusChange: setVoiceStatus,
    });

    voiceEngineRef.current = voiceEngine;
    setError('');
    setInfoMessage('');
    setIsBooting(true);
    setIsJoinedRoom(false);
    setRoomEnded(false);
    setParticipants([]);
    setRemoteStreams([]);
    setLocalStream(null);
    setRoomMediaMode(requestedMediaMode);
    setSelfPeerId('');
    setMuted(false);
    setCameraAvailable(false);
    setCameraEnabled(requestedMediaMode === 'video');

    async function bootRoom() {
      let peerId = '';

      try {
        peerId = await voiceEngine.initialize({ participantId: participantIdRef.current });

        if (active) {
          setSelfPeerId(peerId);
        }
      } catch {
        if (active) {
          setVoiceStatus('Signal offline');
          setInfoMessage('Chat is still available');
        }
      }

      try {
        const room = isHost
          ? await createRoom({
              displayName,
              mediaMode: requestedMediaMode,
              participantId: participantIdRef.current,
              peerId,
              roomId,
            })
          : await joinRoom({
              displayName,
              participantId: participantIdRef.current,
              peerId,
              roomId,
            });

        if (!active) {
          return;
        }

        setIsJoinedRoom(true);

        const nextRoomMediaMode = room?.metadata?.mediaMode || requestedMediaMode;
        setRoomMediaMode(nextRoomMediaMode);

        if (!peerId) {
          return;
        }

        try {
          await voiceEngine.ensureLocalStream({ mediaMode: nextRoomMediaMode });
          const localState = voiceEngine.getLocalState();

          if (!active) {
            return;
          }

          setMuted(!localState.audioEnabled);
          setCameraAvailable(localState.hasVideoTrack);
          setCameraEnabled(localState.videoEnabled);

          await updateParticipantState({
            roomId,
            participantId: participantIdRef.current,
            patch: {
              audioEnabled: localState.audioEnabled,
              peerId,
              videoEnabled: localState.videoEnabled,
            },
          });

          setVoiceStatus(
            nextRoomMediaMode === 'video'
              ? localState.hasVideoTrack
                ? 'Video ready'
                : 'Voice ready'
              : 'Voice ready',
          );
        } catch {
          if (!active) {
            return;
          }

          setVoiceStatus('Media blocked');
          setInfoMessage('Allow mic / camera in browser settings');

          await updateParticipantState({
            roomId,
            participantId: participantIdRef.current,
            patch: {
              audioEnabled: false,
              peerId,
              videoEnabled: false,
            },
          });
        }
      } catch (bootError) {
        if (!active) {
          return;
        }

        setError(bootError?.message || 'Unable to join room');
      } finally {
        if (active) {
          setIsBooting(false);
        }
      }
    }

    void bootRoom();

    return () => {
      active = false;
      voiceEngine.destroy();
      voiceEngineRef.current = null;
    };
  }, [displayName, isHost, requestedMediaMode, roomId]);

  useEffect(() => {
    if (!roomId || !displayName || error || !isJoinedRoom) {
      return undefined;
    }

    const unsubscribeFromRoom = subscribeToRoom(roomId, (room) => {
      if (!room) {
        setRoomEnded(true);
        return;
      }

      setRoomMediaMode(room.metadata?.mediaMode || 'voice');
    });

    const unsubscribeFromParticipants = subscribeToParticipants(roomId, (nextParticipants) => {
      setParticipants(nextParticipants);

      if (selfPeerId) {
        void voiceEngineRef.current?.syncParticipants(
          nextParticipants,
          participantIdRef.current,
        );
      }
    });

    return () => {
      unsubscribeFromRoom();
      unsubscribeFromParticipants();
    };
  }, [displayName, error, isJoinedRoom, roomId, selfPeerId]);

  useCleanupHook({
    enabled: Boolean(roomId && isJoinedRoom && !error),
    onPageHide: () => {
      voiceEngineRef.current?.destroy();
    },
    participantId: participantIdRef.current,
    roomId,
  });

  async function syncSelfParticipant(patch) {
    if (!isJoinedRoom || !roomId) {
      return;
    }

    await updateParticipantState({
      roomId,
      participantId: participantIdRef.current,
      patch,
    });
  }

  async function handleLeave() {
    if (!roomId || !isJoinedRoom) {
      navigate('/');
      return;
    }

    try {
      await leaveRoom({
        participantId: participantIdRef.current,
        roomId,
      });
    } catch (leaveError) {
      console.error(leaveError);
    } finally {
      voiceEngineRef.current?.destroy();
      navigate('/');
    }
  }

  async function handleCopyInvite() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopyState('Copied');
      window.setTimeout(() => setCopyState('Copy'), 1800);
    } catch {
      setCopyState('Retry');
      window.setTimeout(() => setCopyState('Copy'), 1800);
    }
  }

  function handleSaveName(event) {
    event.preventDefault();

    const cleanName = sanitizeDisplayName(nameDraft);
    localStorage.setItem(STORAGE_KEY, cleanName);
    setDisplayName(cleanName);
  }

  function handleToggleMute() {
    const localState = voiceEngineRef.current?.setMuted(!muted) || {
      audioEnabled: !muted,
    };

    setMuted(!localState.audioEnabled);
    void syncSelfParticipant({
      audioEnabled: localState.audioEnabled,
    });
  }

  function handleToggleCamera() {
    const localState = voiceEngineRef.current?.setCameraEnabled(!cameraEnabled);

    if (!localState || localState === false) {
      return;
    }

    setCameraEnabled(localState.videoEnabled);
    void syncSelfParticipant({
      videoEnabled: localState.videoEnabled,
    });
  }

  if (!isFirebaseReady()) {
    return (
      <main className="room-page centered page-shell">
        <section className="card status-card elevated-card">
          <span className="eyebrow">Setup</span>
          <h1>Firebase setup required</h1>
          <p>{getFirebaseConfigError()}</p>
          <Link className="secondary-button link-button" to="/">
            Back
          </Link>
        </section>
      </main>
    );
  }

  if (!displayName) {
    return (
      <main className="room-page centered page-shell">
        <section className="card status-card elevated-card">
          <span className="eyebrow">Profile</span>
          <h1>Enter name</h1>
          <form className="name-gate" onSubmit={handleSaveName}>
            <input
              className="text-input"
              maxLength={24}
              onChange={(event) => setNameDraft(event.target.value)}
              placeholder="Your name"
              value={nameDraft}
            />
            <button className="primary-button" type="submit">
              Continue
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (roomEnded) {
    return (
      <main className="room-page centered page-shell">
        <section className="card status-card elevated-card">
          <span className="eyebrow">Room</span>
          <h1>Room closed</h1>
          <p>สร้างห้องใหม่เพื่อเริ่มอีกครั้ง</p>
          <Link className="primary-button link-button" to="/">
            New room
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="room-page page-shell room-shell">
      <RoomHeader
        copyState={copyState}
        inviteLink={inviteLink}
        onCopyInvite={handleCopyInvite}
        onToggleTheme={onToggleTheme}
        participantCount={participants.length || 1}
        roomId={roomId}
        roomMediaMode={roomMediaMode}
        theme={theme}
      />

      {error ? <p className="feedback error">{error}</p> : null}
      {infoMessage ? <p className="feedback subtle">{infoMessage}</p> : null}
      {isBooting ? <p className="feedback">Connecting...</p> : null}

      <div className="room-layout refined-room-layout">
        <div className="primary-column">
          <AudioStreamRack
            localStream={localStream}
            mediaMode={roomMediaMode}
            participants={participants}
            remoteStreams={remoteStreams}
          />
          <ChatProvider key={roomId} participant={selfParticipant} roomId={roomId}>
            <ChatPanel disabled={Boolean(error)} selfParticipantId={participantIdRef.current} />
          </ChatProvider>
        </div>

        <aside className="sidebar-column">
          <RoomConsole
            cameraAvailable={cameraAvailable}
            cameraEnabled={cameraEnabled}
            mediaConnected={Boolean(selfPeerId && localStream)}
            muted={muted}
            onLeave={handleLeave}
            onToggleCamera={handleToggleCamera}
            onToggleMute={handleToggleMute}
            roomMediaMode={roomMediaMode}
            voiceStatus={voiceStatus}
          />
          <ParticipantsPanel
            participants={participants.length ? participants : [selfParticipant]}
            roomMediaMode={roomMediaMode}
            selfParticipantId={participantIdRef.current}
          />
        </aside>
      </div>
    </main>
  );
}

export default RoomPage;

