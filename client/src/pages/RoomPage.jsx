import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import AudioStreamRack from '../components/AudioStreamRack.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import MediaSettingsModal from '../components/MediaSettingsModal.jsx';
import RoomConsole from '../components/RoomConsole.jsx';
import RoomHeader from '../components/RoomHeader.jsx';
import WatchPartyPanel from '../components/WatchPartyPanel.jsx';
import { useCleanupHook } from '../hooks/CleanupHook.js';
import { getFirebaseConfigError, isFirebaseReady } from '../lib/firebase.js';
import { createParticipantId } from '../lib/roomId.js';
import { sanitizeDisplayName, sanitizeRoomId } from '../lib/sanitize.js';
import { ChatProvider } from '../providers/ChatProvider.jsx';
import {
  clearWatchParty,
  createRoom,
  joinRoom,
  leaveRoom,
  subscribeToParticipants,
  subscribeToRoom,
  updateParticipantState,
  updateWatchParty,
} from '../services/RoomManager.js';
import { VoiceEngine } from '../services/VoiceEngine.js';

const STORAGE_KEY = 'ephemeral-chat-display-name';

function RoomPage({ onToggleTheme, theme }) {
  const navigate = useNavigate();
  const { roomId: routeRoomId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const participantIdRef = useRef(createParticipantId());
  const voiceEngineRef = useRef(null);
  const stagePanelRef = useRef(null);
  const screenPanelRef = useRef(null);
  const watchPanelRef = useRef(null);
  const railPanelRef = useRef(null);

  const roomId = sanitizeRoomId(routeRoomId);
  const requestedMediaMode = searchParams.get('mode') === 'video' ? 'video' : 'voice';
  const isHost = searchParams.get('host') === '1';

  const [displayName, setDisplayName] = useState(() => localStorage.getItem(STORAGE_KEY) || '');
  const [nameDraft, setNameDraft] = useState(displayName);
  const [copyState, setCopyState] = useState('Copy');
  const [roomCodeState, setRoomCodeState] = useState('Copy room');
  const [shareState, setShareState] = useState('Share');
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [isBooting, setIsBooting] = useState(true);
  const [isJoinedRoom, setIsJoinedRoom] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraAvailable, setCameraAvailable] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(requestedMediaMode === 'video');
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenShareSupported, setScreenShareSupported] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [localStream, setLocalStream] = useState(null);
  const [localPreviewStream, setLocalPreviewStream] = useState(null);
  const [roomEnded, setRoomEnded] = useState(false);
  const [selfPeerId, setSelfPeerId] = useState('');
  const [roomMediaMode, setRoomMediaMode] = useState(requestedMediaMode);
  const [voiceStatus, setVoiceStatus] = useState('Connecting...');
  const [availableDevices, setAvailableDevices] = useState({
    audioInputs: [],
    videoInputs: [],
  });
  const [selectedDevices, setSelectedDevices] = useState({
    audioInputId: '',
    videoInputId: '',
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [watchParty, setWatchParty] = useState(null);
  const [watchPartyOpen, setWatchPartyOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [focusedPanel, setFocusedPanel] = useState(null);

  const inviteLink = `${window.location.origin}/room/${roomId}`;
  const selfParticipant = {
    id: participantIdRef.current,
    isHost,
    name: displayName,
    peerId: selfPeerId,
    audioEnabled: Boolean(localStream) && !muted,
    screenSharing,
    videoEnabled: cameraEnabled,
  };

  const watchPartyActive = Boolean(watchParty?.videoId);
  const showWatchPanel = watchPartyOpen || watchPartyActive;
  const anyScreenSharing = screenSharing || participants.some((participant) => participant.screenSharing);
  const hasPriorityMedia = watchPartyActive || anyScreenSharing;
  const showLiveRail = hasPriorityMedia && (roomMediaMode === 'video' || Boolean(localPreviewStream) || remoteStreams.length > 0);

  function applyLocalState(localState) {
    setMuted(!localState.audioEnabled);
    setCameraAvailable(localState.cameraAvailable || localState.hasVideoTrack);
    setCameraEnabled(localState.videoEnabled);
    setScreenSharing(Boolean(localState.screenSharing));
    setSelectedDevices({
      audioInputId: localState.audioInputId || '',
      videoInputId: localState.videoInputId || '',
    });
  }

  async function reconnectMedia() {
    if (!selfPeerId) {
      return;
    }

    await voiceEngineRef.current?.reconnectParticipants(participants, participantIdRef.current);
  }

  async function toggleFullscreen(targetRef) {
    if (!targetRef.current) {
      return;
    }

    if (document.fullscreenElement === targetRef.current) {
      await document.exitFullscreen?.();
      return;
    }

    await targetRef.current.requestFullscreen?.();
  }

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

  const onLocalPreviewStream = useEffectEvent((stream) => {
    setLocalPreviewStream(stream);
  });

  const onVoiceError = useEffectEvent((voiceError) => {
    const nextMessage = voiceError?.message || 'Media unavailable';
    setVoiceStatus(nextMessage);
  });

  const onDevicesChanged = useEffectEvent((nextDevices) => {
    setAvailableDevices(nextDevices);
  });

  useEffect(() => {
    if (!watchPartyActive && focusedPanel === 'watch') {
      setFocusedPanel(null);
    }
  }, [focusedPanel, watchPartyActive]);

  useEffect(() => {
    if (watchPartyActive) {
      setWatchPartyOpen(true);
    }
  }, [watchPartyActive]);

  useEffect(() => {
    if (!roomId) {
      setError('Room code is missing');
      setIsBooting(false);
      return undefined;
    }

    if (!displayName || !isFirebaseReady()) {
      setIsBooting(false);
      return undefined;
    }

    let active = true;
    const voiceEngine = new VoiceEngine({
      onDevicesChanged,
      onError: onVoiceError,
      onLocalStream,
      onLocalPreviewStream,
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
    setLocalPreviewStream(null);
    setRoomMediaMode(requestedMediaMode);
    setSelfPeerId('');
    setMuted(false);
    setCameraAvailable(false);
    setCameraEnabled(requestedMediaMode === 'video');
    setScreenSharing(false);
    setScreenShareSupported(false);
    setAvailableDevices({ audioInputs: [], videoInputs: [] });
    setSelectedDevices({ audioInputId: '', videoInputId: '' });
    setWatchParty(null);
    setWatchPartyOpen(false);
    setChatOpen(false);
    setFocusedPanel(null);

    async function bootRoom() {
      let peerId = '';

      try {
        peerId = await voiceEngine.initialize({ participantId: participantIdRef.current });

        if (active) {
          setSelfPeerId(peerId);
          setScreenShareSupported(voiceEngine.supportsScreenShare());
          setAvailableDevices(voiceEngine.getAvailableDevices());
          setSelectedDevices(voiceEngine.getPreferredDevices());
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
        setWatchParty(room?.metadata?.watchParty || null);

        if (!peerId) {
          return;
        }

        try {
          await voiceEngine.ensureLocalStream({ mediaMode: nextRoomMediaMode });
          await voiceEngine.refreshDevices();
          const localState = voiceEngine.getLocalState();

          if (!active) {
            return;
          }

          setAvailableDevices(voiceEngine.getAvailableDevices());
          applyLocalState(localState);

          await updateParticipantState({
            roomId,
            participantId: participantIdRef.current,
            patch: {
              audioEnabled: localState.audioEnabled,
              peerId,
              screenSharing: localState.screenSharing,
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
              screenSharing: false,
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
      setWatchParty(room.metadata?.watchParty || null);
    });

    const unsubscribeFromParticipants = subscribeToParticipants(roomId, (nextParticipants) => {
      setParticipants(nextParticipants);

      if (selfPeerId) {
        void voiceEngineRef.current?.syncParticipants(nextParticipants, participantIdRef.current);
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

  async function handleCopyRoomId() {
    try {
      await navigator.clipboard.writeText(roomId);
      setRoomCodeState('Copied');
      window.setTimeout(() => setRoomCodeState('Copy room'), 1800);
    } catch {
      setRoomCodeState('Retry');
      window.setTimeout(() => setRoomCodeState('Copy room'), 1800);
    }
  }

  async function handleShareInvite() {
    try {
      if (navigator.share) {
        await navigator.share({
          text: `Join room ${roomId}`,
          title: `Private Meeting ${roomId}`,
          url: inviteLink,
        });
        setShareState('Shared');
        window.setTimeout(() => setShareState('Share'), 1800);
        return;
      }

      await navigator.clipboard.writeText(inviteLink);
      setShareState('Shared');
      window.setTimeout(() => setShareState('Share'), 1800);
    } catch (shareError) {
      if (shareError?.name === 'AbortError') {
        setShareState('Share');
        return;
      }

      setShareState('Retry');
      window.setTimeout(() => setShareState('Share'), 1800);
    }
  }

  function handleSaveName(event) {
    event.preventDefault();
    const cleanName = sanitizeDisplayName(nameDraft);
    localStorage.setItem(STORAGE_KEY, cleanName);
    setDisplayName(cleanName);
  }

  async function handleToggleMute() {
    const localState = voiceEngineRef.current?.setMuted(!muted) || {
      audioEnabled: !muted,
    };

    applyLocalState(localState);
    await syncSelfParticipant({
      audioEnabled: localState.audioEnabled,
    });
  }

  async function handleToggleCamera() {
    const localState = voiceEngineRef.current?.setCameraEnabled(!cameraEnabled);

    if (!localState || localState === false) {
      return;
    }

    applyLocalState(localState);
    await syncSelfParticipant({
      screenSharing: localState.screenSharing,
      videoEnabled: localState.videoEnabled,
    });
  }

  async function handleRefreshDevices() {
    const nextDevices = await voiceEngineRef.current?.refreshDevices();

    if (nextDevices) {
      setAvailableDevices(nextDevices);
    }
  }

  async function handleApplyDevices(nextSelection) {
    try {
      const localState = await voiceEngineRef.current?.applyDevicePreferences(nextSelection, {
        mediaMode: roomMediaMode,
      });

      if (!localState) {
        return;
      }

      applyLocalState(localState);
      setAvailableDevices(voiceEngineRef.current?.getAvailableDevices() || availableDevices);
      await syncSelfParticipant({
        audioEnabled: localState.audioEnabled,
        screenSharing: localState.screenSharing,
        videoEnabled: localState.videoEnabled,
      });
      await reconnectMedia();
      setSettingsOpen(false);
      setInfoMessage('Media device updated');
    } catch (deviceError) {
      setInfoMessage(deviceError?.message || 'Unable to update devices');
    }
  }

  async function handleToggleScreenShare() {
    try {
      const localState = screenSharing
        ? await voiceEngineRef.current?.stopScreenShare()
        : await voiceEngineRef.current?.startScreenShare();

      if (!localState) {
        return;
      }

      applyLocalState(localState);
      await syncSelfParticipant({
        audioEnabled: localState.audioEnabled,
        screenSharing: localState.screenSharing,
        videoEnabled: localState.videoEnabled,
      });
      await reconnectMedia();
    } catch (shareError) {
      setInfoMessage(shareError?.message || 'Unable to share screen');
    }
  }

  async function handleSyncWatchParty(nextState) {
    if (!roomId) {
      return;
    }

    await updateWatchParty({
      roomId,
      nextState,
    });
  }

  async function handleClearWatchParty() {
    if (!roomId) {
      return;
    }

    await clearWatchParty(roomId);
    setWatchPartyOpen(false);
    if (focusedPanel === 'watch') {
      setFocusedPanel(null);
    }
  }

  function handleToggleWatchParty() {
    setWatchPartyOpen((current) => {
      const nextValue = !current;

      if (!nextValue && !watchPartyActive && focusedPanel === 'watch') {
        setFocusedPanel(null);
      }

      return nextValue;
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
          <p>This room is no longer active. Create a new room to continue.</p>
          <Link className="primary-button link-button" to="/">
            New room
          </Link>
        </section>
      </main>
    );
  }

  const liveRailPanel = showLiveRail ? (
    <div className={`panel-shell media-rail-shell ${focusedPanel === 'rail' ? 'is-focused' : ''}`} ref={railPanelRef}>
      <AudioStreamRack
        isExpanded={focusedPanel === 'rail'}
        layoutMode="rail"
        localPreviewStream={localPreviewStream}
        localScreenSharing={screenSharing}
        localStream={localStream}
        localAudioEnabled={!muted}
        localVideoEnabled={cameraEnabled}
        mediaMode={roomMediaMode}
        onToggleExpand={() => setFocusedPanel((current) => (current === 'rail' ? null : 'rail'))}
        onToggleFullscreen={() => {
          void toggleFullscreen(railPanelRef);
        }}
        participants={participants}
        remoteStreams={remoteStreams}
      />
    </div>
  ) : null;

  const stagePanel = (
    <div className={`panel-shell stage-shell ${focusedPanel === 'stage' ? 'is-focused' : ''}`} ref={stagePanelRef}>
      <AudioStreamRack
        isExpanded={focusedPanel === 'stage'}
        localScreenSharing={screenSharing}
        localStream={localStream}
        localPreviewStream={localPreviewStream}
        localAudioEnabled={!muted}
        localVideoEnabled={cameraEnabled}
        mediaMode={roomMediaMode}
        onToggleExpand={() => setFocusedPanel((current) => (current === 'stage' ? null : 'stage'))}
        onToggleFullscreen={() => {
          void toggleFullscreen(stagePanelRef);
        }}
        participants={participants}
        remoteStreams={remoteStreams}
      />
    </div>
  );

  const screenPanel = anyScreenSharing ? (
    <div className={`panel-shell screen-shell ${focusedPanel === 'screen' ? 'is-focused' : ''}`} ref={screenPanelRef}>
      <AudioStreamRack
        isExpanded={focusedPanel === 'screen'}
        layoutMode="screen"
        localScreenSharing={screenSharing}
        localStream={localStream}
        localPreviewStream={localPreviewStream}
        localAudioEnabled={!muted}
        localVideoEnabled={cameraEnabled}
        mediaMode={roomMediaMode}
        onToggleExpand={() => setFocusedPanel((current) => (current === 'screen' ? null : 'screen'))}
        onToggleFullscreen={() => {
          void toggleFullscreen(screenPanelRef);
        }}
        participants={participants}
        remoteStreams={remoteStreams}
      />
    </div>
  ) : null;

  const watchPanel = (
    <div className={`panel-shell watch-shell ${watchPartyActive ? 'watch-live' : 'watch-idle'} ${focusedPanel === 'watch' ? 'is-focused' : ''}`} ref={watchPanelRef}>
      <WatchPartyPanel
        isExpanded={focusedPanel === 'watch'}
        onClear={handleClearWatchParty}
        onSyncState={handleSyncWatchParty}
        onToggleExpand={() => setFocusedPanel((current) => (current === 'watch' ? null : 'watch'))}
        onToggleFullscreen={() => {
          void toggleFullscreen(watchPanelRef);
        }}
        participantId={participantIdRef.current}
        watchParty={watchParty}
      />
    </div>
  );

  const centerPanels = [];

  if (watchPartyActive) {
    centerPanels.push(watchPanel);
  }

  if (anyScreenSharing) {
    centerPanels.push(screenPanel);
  }

  if (!hasPriorityMedia) {
    centerPanels.push(stagePanel);
  }

  return (
    <>
      <main className="room-page page-shell room-shell">
        <RoomHeader
          copyState={copyState}
          inviteLink={inviteLink}
          onCopyInvite={handleCopyInvite}
          onCopyRoomId={handleCopyRoomId}
          onShareInvite={handleShareInvite}
          onToggleTheme={onToggleTheme}
          roomCodeState={roomCodeState}
          roomId={roomId}
          shareState={shareState}
          theme={theme}
        />

        {error ? <p className="feedback error">{error}</p> : null}
        {infoMessage ? <p className="feedback subtle">{infoMessage}</p> : null}
        {isBooting ? <p className="feedback">Connecting...</p> : null}

        <div className={`room-studio ${hasPriorityMedia ? 'priority-media' : 'default-media'} ${showLiveRail ? 'show-rail studio-has-rail' : 'hide-rail'} ${chatOpen ? 'studio-has-chat' : 'studio-no-chat'} ${watchPartyActive ? 'watch-active' : 'watch-idle'} ${anyScreenSharing ? 'screen-active' : ''}`}>
          {showLiveRail ? (
            <aside className="studio-left-column">
              {liveRailPanel}
            </aside>
          ) : null}

          <section className="studio-center-column">
            {centerPanels.map((panel, index) => (
              <div className="studio-center-slot" key={index}>
                {panel}
              </div>
            ))}
            {showWatchPanel && !watchPartyActive ? watchPanel : null}
          </section>

          {chatOpen ? (
            <aside className="studio-right-column">
              <ChatProvider key={roomId} participant={selfParticipant} roomId={roomId}>
                <ChatPanel disabled={Boolean(error)} selfParticipantId={participantIdRef.current} />
              </ChatProvider>
            </aside>
          ) : null}
        </div>

        <section className="room-bottom-toolbar">
          <RoomConsole
            cameraAvailable={cameraAvailable}
            cameraEnabled={cameraEnabled}
            chatOpen={chatOpen}
            embedded={false}
            mediaConnected={Boolean(selfPeerId && localStream)}
            muted={muted}
            onLeave={handleLeave}
            onOpenSettings={() => {
              void handleRefreshDevices();
              setSettingsOpen(true);
            }}
            onToggleCamera={() => {
              void handleToggleCamera();
            }}
            onToggleChat={() => setChatOpen(!chatOpen)}
            onToggleMute={() => {
              void handleToggleMute();
            }}
            onToggleScreenShare={() => {
              void handleToggleScreenShare();
            }}
            onToggleWatchParty={handleToggleWatchParty}
            roomMediaMode={roomMediaMode}
            screenShareSupported={screenShareSupported}
            screenSharing={screenSharing}
            voiceStatus={voiceStatus}
            watchPartyOpen={showWatchPanel}
          />
        </section>
      </main>

      <MediaSettingsModal
        devices={availableDevices}
        onApply={(nextSelection) => {
          void handleApplyDevices(nextSelection);
        }}
        onClose={() => setSettingsOpen(false)}
        onRefresh={() => {
          void handleRefreshDevices();
        }}
        open={settingsOpen}
        roomMediaMode={roomMediaMode}
        screenShareSupported={screenShareSupported}
        selectedDevices={selectedDevices}
      />
    </>
  );
}

export default RoomPage;

