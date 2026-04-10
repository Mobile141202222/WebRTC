import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PlusIcon,
  RefreshIcon,
  StarIcon,
  TrashIcon,
  MicIcon,
  MicOffIcon,
  PhoneCallIcon,
  PhoneOffIcon,
  VideoIcon,
  VideoOffIcon,
} from '../components/Icons.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import {
  clearStoredAuthSession,
  clearStoredDirectCallProfile,
  createAuthSessionFromToken,
  isDevAuthEnabled,
  loadStoredAuthSession,
  loadStoredDirectCallProfile,
  persistAuthSession,
  persistDirectCallProfile,
} from '../lib/directCallAuth.js';
import { enableIncomingCallPush, showIncomingCallNotification } from '../lib/pushNotifications.js';
import { getFirebaseConfigError, isFirebaseReady } from '../lib/firebase.js';
import { sanitizeDirectCallUserId, sanitizeDisplayName } from '../lib/sanitize.js';
import {
  fetchTurnCredentials,
  notifyIncomingCall,
  registerPushToken,
  requestDevToken,
  unregisterPushToken,
} from '../services/directCallApi.js';
import {
  addDirectCallContact,
  recordDirectCallRecent,
  removeDirectCallContact,
  subscribeToDirectCallDirectory,
  toggleDirectCallFavorite,
  updateDirectCallProfileCapabilities,
  upsertDirectCallProfile,
} from '../services/DirectCallDirectory.js';
import { DirectCallSignal } from '../services/DirectCallSignal.js';
import { DirectCallWebRtc } from '../services/DirectCallWebRtc.js';

const EMPTY_LOCAL_STATE = {
  audioEnabled: false,
  hasVideo: false,
  videoEnabled: false,
};

const EMPTY_SESSION_INFO = {
  pendingCalls: [],
  user: null,
};

const EMPTY_DIRECTORY = {
  contacts: [],
  directory: [],
  recents: [],
  selfProfile: null,
};

function getCallEndedMessage(reason) {
  switch (reason) {
    case 'busy':
      return 'The recipient is already in another call.';
    case 'disconnect':
      return 'The other participant disconnected.';
    case 'timeout':
      return 'No answer before the ring timeout.';
    case 'rejected':
      return 'The call was declined.';
    default:
      return 'The call has ended.';
  }
}

function MediaTile({ label, muted = false, stream }) {
  const mediaElementRef = useRef(null);
  const hasVideo = Boolean(stream?.getVideoTracks?.().length);

  useEffect(() => {
    if (!mediaElementRef.current) {
      return;
    }

    mediaElementRef.current.srcObject = stream || null;
  }, [stream]);

  return (
    <article className="media-tile direct-call-media-tile">
      <div className="media-caption">
        <div>
          <strong>{label}</strong>
          <span>{hasVideo ? 'Video stream' : 'Audio stream'}</span>
        </div>
      </div>

      <div className="media-surface direct-call-surface">
        <video
          autoPlay
          className={`direct-call-media-element ${hasVideo ? 'with-video' : 'audio-only'}`}
          muted={muted}
          playsInline
          ref={mediaElementRef}
        />
        {!hasVideo ? (
          <div className="media-placeholder direct-call-placeholder">
            <div className="participant-avatar premium-avatar">
              {label.slice(0, 1).toUpperCase()}
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function getCapabilityMeta(capability) {
  switch (capability) {
    case 'online':
      return {
        className: 'is-online',
        label: 'Online',
      };
    case 'background':
      return {
        className: 'is-background',
        label: 'Background',
      };
    case 'push-ready':
      return {
        className: 'is-push-ready',
        label: 'Push ready',
      };
    default:
      return {
        className: 'is-offline',
        label: 'Offline',
      };
  }
}

function matchesSearch(entry, searchTerm) {
  if (!searchTerm) {
    return true;
  }

  const haystack = `${entry.displayName} ${entry.userId} ${entry.contactLabel || ''}`.toLowerCase();
  return haystack.includes(searchTerm.toLowerCase());
}

function PersonCard({
  allowAdd = false,
  allowFavorite = false,
  allowRemove = false,
  disabled = false,
  entry,
  onAdd,
  onAudioCall,
  onRemove,
  onToggleFavorite,
  onVideoCall,
}) {
  const capabilityMeta = getCapabilityMeta(entry.capability);

  return (
    <article className="direct-call-person-card">
      <div className="direct-call-person-head">
        <div>
          <strong>{entry.displayName}</strong>
          <span>@{entry.userId}</span>
        </div>
        <span className={`direct-call-capability ${capabilityMeta.className}`}>
          {capabilityMeta.label}
        </span>
      </div>

      <div className="direct-call-person-meta">
        <span>{entry.canReceivePush ? 'Can wake via push' : 'Open app for instant ring'}</span>
        {entry.lastDirection ? <span>Last: {entry.lastDirection}</span> : null}
      </div>

      <div className="direct-call-person-actions">
        <button
          className="primary-button icon-text-button"
          disabled={disabled}
          onClick={() => onAudioCall(entry)}
          type="button"
        >
          <PhoneCallIcon />
          <span>Audio</span>
        </button>
        <button
          className="secondary-button icon-text-button"
          disabled={disabled}
          onClick={() => onVideoCall(entry)}
          type="button"
        >
          <VideoIcon />
          <span>Video</span>
        </button>
      </div>

      <div className="direct-call-person-secondary">
        {allowFavorite ? (
          <button
            className={`secondary-button icon-text-button ${entry.favorite ? 'is-active' : ''}`}
            onClick={() => onToggleFavorite(entry)}
            type="button"
          >
            <StarIcon />
            <span>{entry.favorite ? 'Pinned' : 'Pin'}</span>
          </button>
        ) : null}
        {allowAdd ? (
          <button className="secondary-button icon-text-button" onClick={() => onAdd(entry)} type="button">
            <PlusIcon />
            <span>Add</span>
          </button>
        ) : null}
        {allowRemove ? (
          <button className="danger-button icon-text-button" onClick={() => onRemove(entry)} type="button">
            <TrashIcon />
            <span>Remove</span>
          </button>
        ) : null}
      </div>
    </article>
  );
}

function DirectCallPage({ onToggleTheme, theme }) {
  const initialSession = loadStoredAuthSession();
  const initialProfile = loadStoredDirectCallProfile() || initialSession || null;

  const [authSession, setAuthSession] = useState(initialSession);
  const [storedProfile, setStoredProfile] = useState(initialProfile);
  const [jwtDraft, setJwtDraft] = useState(() => initialSession?.token || '');
  const [profileUserIdDraft, setProfileUserIdDraft] = useState(() => initialProfile?.userId || '');
  const [profileDisplayNameDraft, setProfileDisplayNameDraft] = useState(() => initialProfile?.displayName || '');
  const [quickEntryDraft, setQuickEntryDraft] = useState('');
  const [directorySearch, setDirectorySearch] = useState('');
  const [authError, setAuthError] = useState('');
  const [profileError, setProfileError] = useState('');
  const [connectionState, setConnectionState] = useState('offline');
  const [sessionInfo, setSessionInfo] = useState(EMPTY_SESSION_INFO);
  const [callPhase, setCallPhase] = useState('idle');
  const [activeCall, setActiveCall] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [statusMessage, setStatusMessage] = useState('Set up this device once, then place calls from your contacts list.');
  const [callError, setCallError] = useState('');
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [localState, setLocalState] = useState(EMPTY_LOCAL_STATE);
  const [directoryState, setDirectoryState] = useState(EMPTY_DIRECTORY);
  const [profileBusy, setProfileBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [autoConnectPaused, setAutoConnectPaused] = useState(false);
  const [pushState, setPushState] = useState({
    enabled: false,
    permission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
    pushToken: '',
    reason: '',
    supported: typeof window !== 'undefined' && 'Notification' in window,
  });

  const signalRef = useRef(null);
  const webrtcRef = useRef(null);
  const activeCallRef = useRef(null);
  const authSessionRef = useRef(null);
  const connectionStateRef = useRef('offline');
  const autoConnectAttemptedRef = useRef(false);

  activeCallRef.current = activeCall;
  authSessionRef.current = authSession;
  connectionStateRef.current = connectionState;

  const currentUserId = authSession?.userId || sessionInfo?.user?.userId || storedProfile?.userId || '';
  const currentDisplayName = authSession?.displayName || storedProfile?.displayName || sessionInfo?.user?.displayName || '';

  function resetCallState(message = 'Ready to call from your contact list.') {
    const previousCallId = activeCallRef.current?.callId;

    if (previousCallId) {
      signalRef.current?.releaseCall(previousCallId);
    }

    webrtcRef.current?.teardownCall();
    setActiveCall(null);
    setIncomingCall(null);
    setCallPhase('idle');
    setLocalState(EMPTY_LOCAL_STATE);
    setStatusMessage(message);
  }

  function persistDeviceProfile(profile) {
    persistDirectCallProfile(profile);
    setStoredProfile(profile);
    setProfileUserIdDraft(profile.userId);
    setProfileDisplayNameDraft(profile.displayName);
  }

  const handlePeerStateChange = useEffectEvent((state) => {
    if (state === 'connected') {
      setCallPhase('in-call');
      setStatusMessage('Secure media connected.');
      return;
    }

    if (state === 'failed' || state === 'disconnected' || state === 'closed') {
      if (!activeCallRef.current?.callId) {
        return;
      }

      resetCallState(state === 'failed' ? 'Media connection failed.' : 'Call connection ended.');
    }
  });

  useEffect(() => {
    const engine = new DirectCallWebRtc({
      onConnectionStateChange: (state) => {
        handlePeerStateChange(state);
      },
      onIceCandidate: (candidate) => {
        const currentCall = activeCallRef.current;

        if (!candidate || !currentCall?.callId) {
          return;
        }

        void signalRef.current?.sendIceCandidate({
          callId: currentCall.callId,
          candidate,
        }).catch(() => {
          // Ignore ICE updates during reconnects or teardown.
        });
      },
      onLocalStateChange: setLocalState,
      onLocalStream: setLocalStream,
      onRemoteStream: setRemoteStream,
    });

    webrtcRef.current = engine;

    return () => {
      engine.destroy();
      webrtcRef.current = null;
    };
  }, []);

  const ensureIceConfiguration = useEffectEvent(async () => {
    const currentSession = authSessionRef.current;

    if (!currentSession?.token) {
      throw new Error('Authentication is required');
    }

    return fetchTurnCredentials(currentSession.token);
  });

  async function syncProfileCapabilities(nextPushState = pushState) {
    if (!currentUserId || !isFirebaseReady()) {
      return;
    }

    await upsertDirectCallProfile({
      displayName: currentDisplayName || currentUserId,
      pushEnabled: nextPushState.enabled,
      pushPermission: nextPushState.permission,
      userId: currentUserId,
    });
  }

  async function connectWithProfile(profile, statusText = 'Connecting direct call session...') {
    const normalizedUserId = sanitizeDirectCallUserId(profile.userId);
    const normalizedDisplayName = sanitizeDisplayName(profile.displayName || normalizedUserId);

    if (!normalizedUserId) {
      throw new Error('Choose a device user ID first');
    }

    const nextProfile = {
      displayName: normalizedDisplayName,
      userId: normalizedUserId,
    };

    persistDeviceProfile(nextProfile);
    setProfileBusy(true);
    setStatusMessage(statusText);
    setAutoConnectPaused(false);
    setProfileError('');
    setAuthError('');

    try {
      if (isDevAuthEnabled()) {
        const response = await requestDevToken(nextProfile);
        const session = createAuthSessionFromToken(response.token);

        setJwtDraft(response.token);
        persistAuthSession(session);
        setAuthSession(session);
        persistDeviceProfile({
          displayName: session.displayName,
          userId: session.userId,
        });
        return session;
      }

      setStatusMessage('Profile saved. Paste a signed JWT to complete authentication.');
      return null;
    } finally {
      setProfileBusy(false);
    }
  }

  async function syncPushRegistration({ requestPermission }) {
    if (!authSession?.token) {
      return;
    }

    setPushBusy(true);

    try {
      const pushResult = await enableIncomingCallPush({
        onForegroundMessage: (payload) => {
          const notificationBody = payload?.notification?.body || 'Incoming call notification received.';
          setStatusMessage(notificationBody);
        },
        requestPermission,
      });

      if (!pushResult.enabled) {
        const nextPushState = {
          enabled: false,
          permission: pushResult.permission || pushState.permission,
          pushToken: '',
          reason: pushResult.reason || 'Push permission was not granted.',
          supported: pushResult.supported,
        };

        setPushState(nextPushState);
        await updateDirectCallProfileCapabilities({
          pushEnabled: false,
          pushPermission: nextPushState.permission,
          userId: authSession.userId,
        }).catch(() => {});
        return;
      }

      await registerPushToken({
        pushToken: pushResult.pushToken,
        token: authSession.token,
      });

      const nextPushState = {
        enabled: true,
        permission: pushResult.permission,
        pushToken: pushResult.pushToken,
        reason: '',
        supported: true,
      };

      setPushState(nextPushState);
      await updateDirectCallProfileCapabilities({
        pushEnabled: true,
        pushPermission: nextPushState.permission,
        userId: authSession.userId,
      }).catch(() => {});
      setStatusMessage('Push notifications are armed for incoming calls.');
    } catch (error) {
      setPushState((current) => ({
        ...current,
        reason: error.message || 'Unable to enable push notifications',
      }));
    } finally {
      setPushBusy(false);
    }
  }

  const syncProfileCapabilitiesEffect = useEffectEvent(() => {
    void syncProfileCapabilities();
  });

  const syncPushRegistrationEffect = useEffectEvent((options) => {
    void syncPushRegistration(options);
  });

  const connectStoredProfileEffect = useEffectEvent((profile, statusText) => {
    void connectWithProfile(profile, statusText);
  });

  const handleSignalEvent = useEffectEvent(async (event) => {
    switch (event.type) {
      case 'call-request':
        setCallError('');
        setActiveCall({
          callId: event.callId,
          calleeUserId: event.calleeUserId,
          direction: 'outgoing',
          mediaMode: event.mediaMode,
        });
        setCallPhase('calling');
        setStatusMessage(`Calling ${event.calleeUserId}...`);
        return;
      case 'incoming-call':
        if (activeCallRef.current?.callId && activeCallRef.current.callId !== event.callId) {
          void signalRef.current?.rejectCall({
            callId: event.callId,
            reason: 'busy',
          });
          return;
        }

        setIncomingCall(event);
        setActiveCall({
          ...event,
          direction: 'incoming',
        });
        setCallPhase('incoming');
        setStatusMessage(`${event.callerName || event.callerId} is calling you.`);
        setCallError('');
        await recordDirectCallRecent({
          direction: 'incoming',
          displayName: event.callerName || event.callerId,
          mediaMode: event.mediaMode,
          otherUserId: event.callerId,
          ownerUserId: authSessionRef.current?.userId,
        }).catch(() => {});

        if (document.visibilityState === 'hidden') {
          await showIncomingCallNotification({
            callId: event.callId,
            callerName: event.callerName || event.callerId,
            mediaMode: event.mediaMode,
          }).catch(() => {});
        }
        return;
      case 'call-picked-up':
        if (activeCallRef.current?.callId === event.callId) {
          resetCallState('The call was answered on another device.');
        }
        return;
      case 'accept-call': {
        setCallPhase('connecting');
        setStatusMessage('Negotiating secure media...');
        // The caller creates the initial offer only after the callee explicitly accepts.
        const iceConfiguration = await ensureIceConfiguration();
        const offer = await webrtcRef.current.startOutgoingCall({
          callId: event.callId,
          iceServers: iceConfiguration.iceServers || [],
          iceTransportPolicy: iceConfiguration.iceTransportPolicy,
          mediaMode: event.mediaMode,
        });

        await signalRef.current?.sendOffer({
          callId: event.callId,
          description: offer,
        });
        return;
      }
      case 'webrtc-offer': {
        setCallPhase('connecting');
        setStatusMessage('Joining the incoming call...');
        // The callee waits for the caller's offer, then answers on the same authenticated call ID.
        const iceConfiguration = await ensureIceConfiguration();
        const answer = await webrtcRef.current.createAnswerForOffer({
          callId: event.callId,
          description: event.description,
          iceServers: iceConfiguration.iceServers || [],
          iceTransportPolicy: iceConfiguration.iceTransportPolicy,
          mediaMode: event.mediaMode,
        });

        await signalRef.current?.sendAnswer({
          callId: event.callId,
          description: answer,
        });
        return;
      }
      case 'webrtc-answer':
        await webrtcRef.current.applyRemoteAnswer(event.description);
        setCallPhase('in-call');
        setStatusMessage('Call connected.');
        return;
      case 'webrtc-ice-candidate':
        await webrtcRef.current.addIceCandidate(event.candidate);
        return;
      case 'reject-call':
        resetCallState(getCallEndedMessage(event.reason));
        return;
      case 'call-timeout':
        resetCallState('No answer before timeout.');
        return;
      case 'end-call':
        resetCallState(getCallEndedMessage(event.reason));
        return;
      case 'error':
        setCallError(event.message || 'Signal error');

        if (event.code === 'target_unavailable' || event.code === 'call_missing') {
          resetCallState(event.message || 'The call is no longer available.');
        }
        return;
      default:
        return;
    }
  });

  useEffect(() => {
    if (!authSession?.token) {
      signalRef.current?.disconnect();
      signalRef.current = null;
      setConnectionState('offline');
      setSessionInfo(EMPTY_SESSION_INFO);
      return undefined;
    }

    let active = true;
    let signal = null;

    try {
      signal = new DirectCallSignal({
        callbacks: {
          onEvent: (event) => {
            if (!active) {
              return;
            }

            void handleSignalEvent(event);
          },
          onConnectionStateChange: (state) => {
            if (!active) {
              return;
            }

            setConnectionState(state);

            if (state === 'online' && !activeCallRef.current?.callId) {
              setStatusMessage('Firebase signaling is online and ready.');
            }

            if (state === 'reconnecting') {
              setStatusMessage('Reconnecting Firebase signaling...');
            }
          },
          onError: (error) => {
            if (!active) {
              return;
            }

            setCallError(error.message || 'Firebase signaling reported an error.');
          },
          onSessionUpdate: (session) => {
            if (!active) {
              return;
            }

            setSessionInfo(session);

            if (
              connectionStateRef.current === 'online'
              && !activeCallRef.current?.callId
              && session.pendingCalls.length === 0
            ) {
              setStatusMessage('Ready to call by user ID.');
            }
          },
        },
        session: {
          ...authSession,
          displayName: storedProfile?.displayName || authSession.displayName,
        },
      });

      signalRef.current = signal;
      setCallError('');
      setAuthError('');
      signal.connect();
    } catch (error) {
      setConnectionState('offline');
      setCallError(error.message || 'Unable to start Firebase signaling.');
      return undefined;
    }

    return () => {
      active = false;

      if (signalRef.current === signal) {
        signal.disconnect();
        signalRef.current = null;
      }
    };
  }, [authSession, storedProfile]);

  useEffect(() => {
    if (!authSession?.userId || !isFirebaseReady()) {
      setDirectoryState(EMPTY_DIRECTORY);
      return undefined;
    }

    return subscribeToDirectCallDirectory({
      callback: setDirectoryState,
      userId: authSession.userId,
    });
  }, [authSession]);

  useEffect(() => {
    if (!authSession?.userId || !isFirebaseReady()) {
      return;
    }

    syncProfileCapabilitiesEffect();
  }, [authSession, currentDisplayName, currentUserId, pushState.enabled, pushState.permission]);

  useEffect(() => {
    if (!authSession?.token || pushBusy || pushState.enabled || Notification.permission !== 'granted') {
      return;
    }

    syncPushRegistrationEffect({
      requestPermission: false,
    });
  }, [authSession, pushBusy, pushState.enabled]);

  useEffect(() => {
    if (
      authSession
      || autoConnectPaused
      || !isDevAuthEnabled()
      || !storedProfile?.userId
      || autoConnectAttemptedRef.current
    ) {
      return;
    }

    autoConnectAttemptedRef.current = true;
    connectStoredProfileEffect(storedProfile, 'Restoring this device...');
  }, [authSession, autoConnectPaused, storedProfile]);

  useEffect(() => {
    if (!authSession?.token) {
      return undefined;
    }

    const handleVisibilityChange = () => {
      signalRef.current?.updateAppState(
        document.visibilityState === 'hidden' ? 'background' : 'foreground',
      );
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authSession]);

  useEffect(() => {
    if (!navigator.serviceWorker) {
      return undefined;
    }

    const handleServiceWorkerMessage = (event) => {
      if (event.data?.type === 'incoming-call-focus') {
        setStatusMessage('Incoming call notification opened.');
      }
    };

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, []);

  async function handleConnectWithJwt() {
    try {
      const session = createAuthSessionFromToken(jwtDraft);
      const nextProfile = {
        displayName: sanitizeDisplayName(session.displayName),
        userId: sanitizeDirectCallUserId(session.userId),
      };

      persistAuthSession(session);
      persistDeviceProfile(nextProfile);
      setAuthSession(session);
      setAutoConnectPaused(false);
      setAuthError('');
      setProfileError('');
      setStatusMessage('Connecting direct call session...');
    } catch (error) {
      setAuthError(error.message || 'Unable to parse JWT');
    }
  }

  async function handleSaveAndConnectProfile() {
    try {
      await connectWithProfile({
        displayName: profileDisplayNameDraft,
        userId: profileUserIdDraft,
      }, authSession ? 'Updating this device profile...' : 'Connecting this device...');
    } catch (error) {
      setProfileError(error.message || 'Unable to connect this device');
    }
  }

  async function handleEnablePush() {
    await syncPushRegistration({
      requestPermission: true,
    });
  }

  async function handleDisconnect() {
    setAutoConnectPaused(true);
    clearStoredAuthSession();
    signalRef.current?.disconnect();
    signalRef.current = null;
    setAuthSession(null);
    setConnectionState('offline');
    setSessionInfo(EMPTY_SESSION_INFO);
    resetCallState('Direct calling disconnected. Reconnect when you are ready.');
  }

  async function handleForgetDevice() {
    if (authSession?.token && pushState.pushToken) {
      await unregisterPushToken({
        pushToken: pushState.pushToken,
        token: authSession.token,
      }).catch(() => {});
    }

    clearStoredAuthSession();
    clearStoredDirectCallProfile();
    signalRef.current?.disconnect();
    signalRef.current = null;
    setAuthSession(null);
    setStoredProfile(null);
    setProfileUserIdDraft('');
    setProfileDisplayNameDraft('');
    setQuickEntryDraft('');
    setDirectoryState(EMPTY_DIRECTORY);
    setPushState({
      enabled: false,
      permission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
      pushToken: '',
      reason: '',
      supported: typeof window !== 'undefined' && 'Notification' in window,
    });
    resetCallState('This device profile has been cleared.');
  }

  async function placeCall({
    mediaMode,
    targetDisplayName,
    targetUserId,
  }) {
    setCallError('');

    if (!authSession?.token) {
      setCallError('Connect this device first.');
      return;
    }

    if (callPhase !== 'idle') {
      setCallError('Finish the current call before dialing another person.');
      return;
    }

    const normalizedTargetId = sanitizeDirectCallUserId(targetUserId);

    if (!normalizedTargetId) {
      setCallError('Choose someone to call first.');
      return;
    }

    try {
      const callId = await signalRef.current?.requestCall({
        calleeUserId: normalizedTargetId,
        mediaMode,
      });

      await recordDirectCallRecent({
        direction: 'outgoing',
        displayName: targetDisplayName || normalizedTargetId,
        mediaMode,
        otherUserId: normalizedTargetId,
        ownerUserId: authSession.userId,
      }).catch(() => {});

      if (callId) {
        await notifyIncomingCall({
          callId,
          calleeUserId: normalizedTargetId,
          callerName: currentDisplayName,
          mediaMode,
          token: authSession.token,
        }).catch(() => {});
      }

      setStatusMessage(`Calling ${targetDisplayName || normalizedTargetId}...`);
    } catch (error) {
      setCallError(error.message || 'Unable to send call request');
    }
  }

  async function handleQuickAddContact() {
    if (!authSession?.userId) {
      setCallError('Connect this device first.');
      return;
    }

    const normalizedUserId = sanitizeDirectCallUserId(quickEntryDraft);

    if (!normalizedUserId) {
      setCallError('Enter a valid user ID first.');
      return;
    }

    await addDirectCallContact({
      contactUserId: normalizedUserId,
      label: normalizedUserId,
      ownerUserId: authSession.userId,
    });
    setQuickEntryDraft('');
    setStatusMessage(`Added @${normalizedUserId} to your contacts.`);
  }

  async function handleAcceptIncomingCall() {
    if (!incomingCall) {
      return;
    }

    try {
      await webrtcRef.current.prepareLocalStream({
        mediaMode: incomingCall.mediaMode,
      });
      setCallPhase('connecting');
      setStatusMessage('Answering the incoming call...');
      await signalRef.current?.acceptCall({
        callId: incomingCall.callId,
      });
      await recordDirectCallRecent({
        direction: 'incoming',
        displayName: incomingCall.callerName || incomingCall.callerId,
        mediaMode: incomingCall.mediaMode,
        otherUserId: incomingCall.callerId,
        ownerUserId: authSession?.userId,
      }).catch(() => {});
      setIncomingCall(null);
    } catch (error) {
      setCallError(error.message || 'Unable to access microphone/camera');
    }
  }

  function handleRejectIncomingCall() {
    if (!incomingCall?.callId) {
      return;
    }

    void signalRef.current?.rejectCall({
      callId: incomingCall.callId,
      reason: 'rejected',
    });
    resetCallState('Incoming call declined.');
  }

  function handleHangUp() {
    if (!activeCall?.callId) {
      return;
    }

    void signalRef.current?.endCall({
      callId: activeCall.callId,
      reason: 'ended',
    });
    resetCallState('Call ended.');
  }

  function handleToggleAudio() {
    setLocalState(webrtcRef.current?.toggleAudio() || EMPTY_LOCAL_STATE);
  }

  function handleToggleVideo() {
    setLocalState(webrtcRef.current?.toggleVideo() || EMPTY_LOCAL_STATE);
  }

  const contactSearchTerm = directorySearch.trim().toLowerCase();
  const filteredContacts = directoryState.contacts.filter((entry) => matchesSearch(entry, contactSearchTerm));
  const filteredDirectory = directoryState.directory.filter((entry) => matchesSearch(entry, contactSearchTerm));
  const filteredRecents = directoryState.recents.filter((entry) => matchesSearch(entry, contactSearchTerm)).slice(0, 6);
  const favoriteContacts = filteredContacts.filter((entry) => entry.favorite).slice(0, 4);
  const pendingCallCount = sessionInfo?.pendingCalls?.length || 0;

  if (!isFirebaseReady()) {
    return (
      <main className="landing-page page-shell direct-call-page-shell">
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

  return (
    <main className="landing-page page-shell direct-call-page-shell">
      <header className="page-topbar">
        <div className="brand-lockup brand-lockup-compact">
          <span className="brand-mark">ROOMKIT</span>
          <h1>Direct Calling</h1>
          <p>JWT-authenticated 1-to-1 calling with targeted signaling and mobile wake-up hooks.</p>
        </div>

        <div className="panel-head-actions">
          <Link className="secondary-button link-button" to="/">
            Rooms
          </Link>
          <ThemeToggle onToggleTheme={onToggleTheme} theme={theme} />
        </div>
      </header>

      <section className="direct-call-grid">
        <article className="card elevated-card direct-call-auth-card">
          <span className="eyebrow">Device</span>
          <h2>{authSession ? 'Ready on this device' : 'Set up once and connect'}</h2>

          <div className="direct-call-profile-form">
            <label className="field-label" htmlFor="direct-call-user-id">
              Device user ID
            </label>
            <input
              className="text-input"
              id="direct-call-user-id"
              maxLength={32}
              onChange={(event) => setProfileUserIdDraft(sanitizeDirectCallUserId(event.target.value))}
              placeholder="anna"
              value={profileUserIdDraft}
            />

            <label className="field-label" htmlFor="direct-call-display-name">
              Display name
            </label>
            <input
              className="text-input"
              id="direct-call-display-name"
              maxLength={24}
              onChange={(event) => setProfileDisplayNameDraft(event.target.value)}
              placeholder="Anna"
              value={profileDisplayNameDraft}
            />

            <button
              className="primary-button"
              disabled={profileBusy}
              onClick={() => {
                void handleSaveAndConnectProfile();
              }}
              type="button"
            >
              {profileBusy ? 'Connecting...' : authSession ? 'Update profile' : 'Save & connect'}
            </button>
          </div>

          <div className="presence-strip direct-call-status-strip">
            <div className="presence-card">
              <div className="presence-copy">
                <strong>User ID</strong>
                <span>{currentUserId || 'Not connected'}</span>
              </div>
            </div>
            <div className="presence-card">
              <div className="presence-copy">
                <strong>Name</strong>
                <span>{currentDisplayName || 'Unnamed'}</span>
              </div>
            </div>
            <div className="presence-card">
              <div className="presence-copy">
                <strong>Signal</strong>
                <span>{connectionState}</span>
              </div>
            </div>
          </div>

          <div className="button-stack">
            <button
              className="secondary-button"
              disabled={!authSession?.token || pushBusy}
              onClick={() => {
                void handleEnablePush();
              }}
              type="button"
            >
              {pushBusy ? 'Arming push...' : pushState.enabled ? 'Push armed' : 'Enable push'}
            </button>
            <button
              className="secondary-button"
              disabled={profileBusy || !storedProfile}
              onClick={() => {
                autoConnectAttemptedRef.current = false;
                setAutoConnectPaused(false);
                void handleSaveAndConnectProfile();
              }}
              type="button"
            >
              <RefreshIcon />
              <span>Reconnect</span>
            </button>
            <button className="danger-button" disabled={!authSession && !storedProfile} onClick={() => {
              void handleDisconnect();
            }} type="button">
              Disconnect
            </button>
            <button className="danger-button ghost-danger" disabled={!storedProfile} onClick={() => {
              void handleForgetDevice();
            }} type="button">
              Forget device
            </button>
          </div>

          <details className="direct-call-advanced-auth">
            <summary>Advanced JWT</summary>
            <p>Paste a signed JWT if you want to override the dev profile and bind direct calling to a real identity.</p>
            <textarea
              className="composer-input direct-call-token-input"
              onChange={(event) => setJwtDraft(event.target.value)}
              placeholder="Paste signed JWT here"
              value={jwtDraft}
            />
            <button className="secondary-button" onClick={() => {
              void handleConnectWithJwt();
            }} type="button">
              Connect with JWT
            </button>
          </details>

          {profileError ? <p className="feedback error">{profileError}</p> : null}
          {authError ? <p className="feedback error">{authError}</p> : null}
          {callError ? <p className="feedback error">{callError}</p> : null}
        </article>

        <article className="card elevated-card direct-call-stage-card">
          <span className="eyebrow">Call Flow</span>
          <h2>Tap a person and call instantly</h2>

          {favoriteContacts.length > 0 ? (
            <section className="direct-call-cluster">
              <div className="panel-head">
                <div className="heading-group">
                  <span className="eyebrow">Pinned</span>
                  <h3>Quick dial</h3>
                </div>
                <span className="count-badge">{favoriteContacts.length}</span>
              </div>

              <div className="direct-call-person-grid compact">
                {favoriteContacts.map((entry) => (
                  <PersonCard
                    allowFavorite
                    entry={entry}
                    key={entry.userId}
                    onAudioCall={(target) => {
                      void placeCall({
                        mediaMode: 'audio',
                        targetDisplayName: target.displayName,
                        targetUserId: target.userId,
                      });
                    }}
                    onToggleFavorite={(target) => {
                      void toggleDirectCallFavorite({
                        contactUserId: target.userId,
                        favorite: !target.favorite,
                        ownerUserId: currentUserId,
                      });
                    }}
                    onVideoCall={(target) => {
                      void placeCall({
                        mediaMode: 'video',
                        targetDisplayName: target.displayName,
                        targetUserId: target.userId,
                      });
                    }}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <div className="direct-call-dialer">
            <div className="panel-head">
              <div className="heading-group">
                <span className="eyebrow">Quick add</span>
                <h3>Add by user ID</h3>
              </div>
              <span className="count-badge">Manual</span>
            </div>
            <input
              className="text-input"
              onChange={(event) => setQuickEntryDraft(sanitizeDirectCallUserId(event.target.value))}
              placeholder="brother"
              value={quickEntryDraft}
            />
            <div className="button-stack">
              <button className="secondary-button" disabled={!authSession?.userId} onClick={() => {
                void handleQuickAddContact();
              }} type="button">
                <PlusIcon />
                <span>Add contact</span>
              </button>
              <button
                className="primary-button"
                disabled={!authSession || callPhase !== 'idle'}
                onClick={() => {
                  void placeCall({
                    mediaMode: 'audio',
                    targetDisplayName: quickEntryDraft,
                    targetUserId: quickEntryDraft,
                  });
                }}
                type="button"
              >
                <PhoneCallIcon />
                <span>Audio</span>
              </button>
              <button
                className="secondary-button"
                disabled={!authSession || callPhase !== 'idle'}
                onClick={() => {
                  void placeCall({
                    mediaMode: 'video',
                    targetDisplayName: quickEntryDraft,
                    targetUserId: quickEntryDraft,
                  });
                }}
                type="button"
              >
                <VideoIcon />
                <span>Video</span>
              </button>
            </div>
          </div>

          <div className="status-pills">
            <span className="status-pill">State: {callPhase}</span>
            <span className="status-pill">Signal: {connectionState}</span>
            <span className="status-pill">Pending: {pendingCallCount}</span>
          </div>

          <p className="feedback subtle">{statusMessage}</p>

          {incomingCall ? (
            <div className="presence-card direct-call-incoming-card">
              <div className="presence-copy">
                <strong>Incoming {incomingCall.mediaMode} call</strong>
                <span>{incomingCall.callerName || incomingCall.callerId}</span>
              </div>
              <div className="button-stack">
                <button className="primary-button" onClick={() => {
                  void handleAcceptIncomingCall();
                }} type="button">
                  Answer
                </button>
                <button className="danger-button" onClick={handleRejectIncomingCall} type="button">
                  Reject
                </button>
              </div>
            </div>
          ) : null}

          {filteredRecents.length > 0 ? (
            <section className="direct-call-cluster">
              <div className="panel-head">
                <div className="heading-group">
                  <span className="eyebrow">Recent</span>
                  <h3>Recent calls</h3>
                </div>
                <span className="count-badge">{filteredRecents.length}</span>
              </div>

              <div className="direct-call-person-grid">
                {filteredRecents.map((entry) => (
                  <PersonCard
                    allowAdd={!directoryState.contacts.some((contact) => contact.userId === entry.userId)}
                    entry={entry}
                    key={entry.userId}
                    onAdd={(target) => {
                      void addDirectCallContact({
                        contactUserId: target.userId,
                        favorite: false,
                        label: target.displayName,
                        ownerUserId: currentUserId,
                      });
                    }}
                    onAudioCall={(target) => {
                      void placeCall({
                        mediaMode: 'audio',
                        targetDisplayName: target.displayName,
                        targetUserId: target.userId,
                      });
                    }}
                    onVideoCall={(target) => {
                      void placeCall({
                        mediaMode: 'video',
                        targetDisplayName: target.displayName,
                        targetUserId: target.userId,
                      });
                    }}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <div className="media-grid direct-call-media-grid">
            <MediaTile label={currentDisplayName || 'You'} muted stream={localStream} />
            <MediaTile
              label={activeCall?.callerName || activeCall?.calleeUserId || activeCall?.callerId || 'Remote'}
              stream={remoteStream}
            />
          </div>

          {(callPhase === 'calling' || callPhase === 'connecting' || callPhase === 'in-call') ? (
            <div className="icon-toolbar direct-call-toolbar">
              <button className="secondary-button icon-button" onClick={handleToggleAudio} type="button">
                {localState.audioEnabled ? <MicIcon /> : <MicOffIcon />}
              </button>
              <button
                className="secondary-button icon-button"
                disabled={!localState.hasVideo}
                onClick={handleToggleVideo}
                type="button"
              >
                {localState.videoEnabled ? <VideoIcon /> : <VideoOffIcon />}
              </button>
              <button className="danger-button icon-button" onClick={handleHangUp} type="button">
                <PhoneOffIcon />
              </button>
            </div>
          ) : null}
        </article>

        <article className="card elevated-card direct-call-side-card">
          <span className="eyebrow">People</span>
          <h2>Contacts and available people</h2>

          <input
            className="text-input"
            onChange={(event) => setDirectorySearch(event.target.value)}
            placeholder="Search people"
            value={directorySearch}
          />

          <div className="presence-strip direct-call-status-strip">
            <div className="presence-card">
              <div className="presence-copy">
                <strong>Push</strong>
                <span>{pushState.enabled ? 'registered' : 'inactive'}</span>
              </div>
            </div>
            <div className="presence-card">
              <div className="presence-copy">
                <strong>Permission</strong>
                <span>{pushState.permission}</span>
              </div>
            </div>
          </div>

          {pushState.reason ? <p className="feedback subtle">{pushState.reason}</p> : null}

          <section className="direct-call-cluster">
            <div className="panel-head">
              <div className="heading-group">
                <span className="eyebrow">Contacts</span>
                <h3>Your people</h3>
              </div>
              <span className="count-badge">{filteredContacts.length}</span>
            </div>

            {filteredContacts.length > 0 ? (
              <div className="direct-call-person-list">
                {filteredContacts.map((entry) => (
                  <PersonCard
                    allowFavorite
                    allowRemove
                    disabled={callPhase !== 'idle' && activeCall?.calleeUserId !== entry.userId}
                    entry={entry}
                    key={entry.userId}
                    onAudioCall={(target) => {
                      void placeCall({
                        mediaMode: 'audio',
                        targetDisplayName: target.displayName,
                        targetUserId: target.userId,
                      });
                    }}
                    onRemove={(target) => {
                      void removeDirectCallContact({
                        contactUserId: target.userId,
                        ownerUserId: currentUserId,
                      });
                    }}
                    onToggleFavorite={(target) => {
                      void toggleDirectCallFavorite({
                        contactUserId: target.userId,
                        favorite: !target.favorite,
                        ownerUserId: currentUserId,
                      });
                    }}
                    onVideoCall={(target) => {
                      void placeCall({
                        mediaMode: 'video',
                        targetDisplayName: target.displayName,
                        targetUserId: target.userId,
                      });
                    }}
                  />
                ))}
              </div>
            ) : (
              <p className="feedback subtle">Add a few people once, then call them from here without typing again.</p>
            )}
          </section>

          <section className="direct-call-cluster">
            <div className="panel-head">
              <div className="heading-group">
                <span className="eyebrow">Available</span>
                <h3>People who can be called</h3>
              </div>
              <span className="count-badge">{filteredDirectory.length}</span>
            </div>

            {filteredDirectory.length > 0 ? (
              <div className="direct-call-person-list">
                {filteredDirectory.slice(0, 10).map((entry) => (
                  <PersonCard
                    allowAdd
                    disabled={callPhase !== 'idle' && activeCall?.calleeUserId !== entry.userId}
                    entry={entry}
                    key={entry.userId}
                    onAdd={(target) => {
                      void addDirectCallContact({
                        contactUserId: target.userId,
                        favorite: false,
                        label: target.displayName,
                        ownerUserId: currentUserId,
                      });
                    }}
                    onAudioCall={(target) => {
                      void placeCall({
                        mediaMode: 'audio',
                        targetDisplayName: target.displayName,
                        targetUserId: target.userId,
                      });
                    }}
                    onVideoCall={(target) => {
                      void placeCall({
                        mediaMode: 'video',
                        targetDisplayName: target.displayName,
                        targetUserId: target.userId,
                      });
                    }}
                  />
                ))}
              </div>
            ) : (
              <p className="feedback subtle">No discoverable people matched your search yet.</p>
            )}
          </section>

          <div className="direct-call-flow-text">
            <strong>Live flow</strong>
            <p>
              <code>contacts</code>
              {' -> '}
              <code>call-request</code>
              {' -> '}
              <code>push wake-up</code>
              {' -> '}
              <code>incoming-call</code>
              {' -> '}
              <code>offer/answer</code>
              {' -> '}
              <code>end-call</code>
            </p>
          </div>

          <div className="direct-call-flow-text">
            <strong>Delivery</strong>
            <p>Online users ring instantly. Offline users can still be woken if this device has already enabled push notifications.</p>
          </div>
        </article>
      </section>
    </main>
  );
}

export default DirectCallPage;
