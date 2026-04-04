import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import AudioStreamRack from '../components/AudioStreamRack.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import ParticipantsPanel from '../components/ParticipantsPanel.jsx';
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
} from '../services/RoomManager.js';
import { VoiceEngine } from '../services/VoiceEngine.js';

const STORAGE_KEY = 'ephemeral-chat-display-name';

function RoomPage() {
  const navigate = useNavigate();
  const { roomId: routeRoomId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const participantIdRef = useRef(createParticipantId());
  const voiceEngineRef = useRef(null);
  const leavingRef = useRef(false);
  const mutedRef = useRef(false);

  const roomId = sanitizeRoomId(routeRoomId);
  const isHost = searchParams.get('host') === '1';
  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem(STORAGE_KEY) || '',
  );
  const [nameDraft, setNameDraft] = useState(displayName);
  const [copyState, setCopyState] = useState('Copy invite');
  const [error, setError] = useState('');
  const [isBooting, setIsBooting] = useState(true);
  const [muted, setMuted] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [roomEnded, setRoomEnded] = useState(false);
  const [selfPeerId, setSelfPeerId] = useState('');
  const [voiceStatus, setVoiceStatus] = useState('Preparing room...');

  const inviteLink = `${window.location.origin}/room/${roomId}`;
  const selfParticipant = {
    id: participantIdRef.current,
    isHost,
    name: displayName,
    peerId: selfPeerId,
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

  const onVoiceError = useEffectEvent((voiceError) => {
    const nextMessage =
      voiceError?.message ||
      'Voice connection needs microphone permission or a reachable PeerJS server.';
    setVoiceStatus(nextMessage);
  });

  useEffect(() => {
    if (!roomId) {
      setError('This invite link is missing a valid room code.');
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
      onRemoteDisconnect,
      onRemoteStream,
      onStatusChange: setVoiceStatus,
    });

    voiceEngineRef.current = voiceEngine;
    setError('');
    setIsBooting(true);
    setParticipants([]);
    setRoomEnded(false);
    setRemoteStreams([]);

    async function bootRoom() {
      try {
        const peerId = await voiceEngine.initialize({
          participantId: participantIdRef.current,
        });

        if (!active) {
          return;
        }

        setSelfPeerId(peerId);

        const payload = {
          displayName,
          participantId: participantIdRef.current,
          peerId,
          roomId,
        };

        if (isHost) {
          await createRoom(payload);
        } else {
          await joinRoom(payload);
        }

        if (!active) {
          return;
        }

        void voiceEngine.ensureLocalStream().then(() => {
          setVoiceStatus('Microphone ready. Voice calls can start.');
          voiceEngine.setMuted(mutedRef.current);
        });
      } catch (bootError) {
        if (!active) {
          return;
        }

        setError(bootError?.message || 'Unable to connect to this room.');
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
  }, [displayName, isHost, roomId]);

  useEffect(() => {
    if (!roomId || !displayName || error || isBooting || !selfPeerId) {
      return undefined;
    }

    const unsubscribeFromRoom = subscribeToRoom(roomId, (room) => {
      if (!room) {
        setRoomEnded(true);
      }
    });

    const unsubscribeFromParticipants = subscribeToParticipants(
      roomId,
      (nextParticipants) => {
        setParticipants(nextParticipants);
        void voiceEngineRef.current?.syncParticipants(
          nextParticipants,
          participantIdRef.current,
        );
      },
    );

    return () => {
      unsubscribeFromRoom();
      unsubscribeFromParticipants();
    };
  }, [displayName, error, isBooting, roomId, selfPeerId]);

  useCleanupHook({
    enabled: Boolean(roomId && selfPeerId && !error),
    onPageHide: () => {
      voiceEngineRef.current?.destroy();
    },
    participantId: participantIdRef.current,
    roomId,
  });

  async function handleLeave() {
    if (!roomId || leavingRef.current) {
      return;
    }

    leavingRef.current = true;

    try {
      if (selfPeerId) {
        await leaveRoom({
          participantId: participantIdRef.current,
          roomId,
        });
      }
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
      window.setTimeout(() => setCopyState('Copy invite'), 1800);
    } catch {
      setCopyState('Copy failed');
      window.setTimeout(() => setCopyState('Copy invite'), 1800);
    }
  }

  function handleSaveName(event) {
    event.preventDefault();

    const cleanName = sanitizeDisplayName(nameDraft);
    localStorage.setItem(STORAGE_KEY, cleanName);
    setDisplayName(cleanName);
  }

  function handleToggleMute() {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setMuted(nextMuted);
    voiceEngineRef.current?.setMuted(nextMuted);
  }

  if (!isFirebaseReady()) {
    return (
      <main className="room-page centered">
        <section className="card status-card">
          <h1>Firebase configuration is required</h1>
          <p>{getFirebaseConfigError()}</p>
          <Link className="secondary-button link-button" to="/">
            Back to home
          </Link>
        </section>
      </main>
    );
  }

  if (!displayName) {
    return (
      <main className="room-page centered">
        <section className="card status-card">
          <span className="eyebrow">Enter the room</span>
          <h1>Pick the name everyone will see</h1>
          <form className="name-gate" onSubmit={handleSaveName}>
            <input
              className="text-input"
              maxLength={24}
              onChange={(event) => setNameDraft(event.target.value)}
              placeholder="Your display name"
              value={nameDraft}
            />
            <button className="primary-button" type="submit">
              Continue to room
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (roomEnded) {
    return (
      <main className="room-page centered">
        <section className="card status-card">
          <span className="eyebrow">Room closed</span>
          <h1>This ephemeral room is no longer active.</h1>
          <p>Create a fresh room to start another text and voice session.</p>
          <Link className="primary-button link-button" to="/">
            Create another room
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="room-page">
      <RoomHeader
        copyState={copyState}
        inviteLink={inviteLink}
        muted={muted}
        onCopyInvite={handleCopyInvite}
        onLeave={handleLeave}
        onToggleMute={handleToggleMute}
        participantCount={participants.length || 1}
        roomId={roomId}
        voiceStatus={voiceStatus}
      />

      {error ? <p className="feedback error">{error}</p> : null}
      {isBooting ? <p className="feedback">Connecting to Firebase and PeerJS...</p> : null}

      <div className="room-layout">
        <div className="primary-column">
          <AudioStreamRack
            participants={participants}
            remoteStreams={remoteStreams}
          />
          <ChatProvider key={roomId} participant={selfParticipant} roomId={roomId}>
            <ChatPanel disabled={isBooting || Boolean(error)} />
          </ChatProvider>
        </div>
        <ParticipantsPanel
          participants={participants.length ? participants : [selfParticipant]}
          selfParticipantId={participantIdRef.current}
        />
      </div>
    </main>
  );
}

export default RoomPage;
