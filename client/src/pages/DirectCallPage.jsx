import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
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
  createAuthSessionFromToken,
  isDevAuthEnabled,
  loadStoredAuthSession,
  persistAuthSession,
} from '../lib/directCallAuth.js';
import { enableIncomingCallPush } from '../lib/pushNotifications.js';
import {
  fetchDirectCallSession,
  fetchTurnCredentials,
  registerPushToken,
  requestDevToken,
  unregisterPushToken,
} from '../services/directCallApi.js';
import { DirectCallSocket } from '../services/DirectCallSocket.js';
import { DirectCallWebRtc } from '../services/DirectCallWebRtc.js';

const EMPTY_LOCAL_STATE = {
  audioEnabled: false,
  hasVideo: false,
  videoEnabled: false,
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

function DirectCallPage({ onToggleTheme, theme }) {
  const [authSession, setAuthSession] = useState(loadStoredAuthSession);
  const [jwtDraft, setJwtDraft] = useState(() => loadStoredAuthSession()?.token || '');
  const [devUserId, setDevUserId] = useState(() => loadStoredAuthSession()?.userId || '');
  const [devDisplayName, setDevDisplayName] = useState(() => loadStoredAuthSession()?.displayName || '');
  const [authError, setAuthError] = useState('');
  const [connectionState, setConnectionState] = useState('offline');
  const [sessionInfo, setSessionInfo] = useState(null);
  const [calleeUserId, setCalleeUserId] = useState('');
  const [callPhase, setCallPhase] = useState('idle');
  const [activeCall, setActiveCall] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [statusMessage, setStatusMessage] = useState('Enter a JWT to connect direct calling.');
  const [callError, setCallError] = useState('');
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [localState, setLocalState] = useState(EMPTY_LOCAL_STATE);
  const [pushState, setPushState] = useState({
    enabled: false,
    permission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
    pushToken: '',
    reason: '',
    supported: typeof window !== 'undefined' && 'Notification' in window,
  });

  const socketRef = useRef(null);
  const webrtcRef = useRef(null);
  const activeCallRef = useRef(null);
  const authSessionRef = useRef(null);

  activeCallRef.current = activeCall;
  authSessionRef.current = authSession;

  function resetCallState(message = 'Ready to call by user ID.') {
    webrtcRef.current?.teardownCall();
    setActiveCall(null);
    setIncomingCall(null);
    setCallPhase('idle');
    setLocalState(EMPTY_LOCAL_STATE);
    setStatusMessage(message);
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

        try {
          socketRef.current?.send('webrtc-ice-candidate', {
            callId: currentCall.callId,
            candidate,
          });
        } catch {
          // Ignore ICE updates during reconnects or teardown.
        }
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

  const handleSocketEvent = useEffectEvent(async (event) => {
    switch (event.type) {
      case 'auth-success':
        setAuthError('');
        setStatusMessage('Socket authenticated and ready.');
        return;
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
          socketRef.current?.send('reject-call', {
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

        socketRef.current?.send('webrtc-offer', {
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

        socketRef.current?.send('webrtc-answer', {
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
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnectionState('offline');
      setSessionInfo(null);
      return undefined;
    }

    let active = true;
    const socket = new DirectCallSocket({
      callbacks: {
        onClose: (event) => {
          if (!active) {
            return;
          }

          if (event.code === 4401) {
            setAuthError(event.reason || 'Authentication failed');
          }
        },
        onConnectionStateChange: (state) => {
          if (!active) {
            return;
          }

          setConnectionState(state);
        },
        onError: () => {
          if (!active) {
            return;
          }

          setCallError('Signal socket reported an error.');
        },
        onEvent: (event) => {
          if (!active) {
            return;
          }

          void handleSocketEvent(event);
        },
      },
      token: authSession.token,
    });

    socketRef.current = socket;
    socket.connect();

    void fetchDirectCallSession(authSession.token)
      .then((session) => {
        if (!active) {
          return;
        }

        setSessionInfo(session);

        if (session.pendingCalls?.length > 0) {
          const [pendingCall] = session.pendingCalls;

          setIncomingCall(pendingCall);
          setActiveCall({
            ...pendingCall,
            direction: 'incoming',
          });
          setCallPhase('incoming');
          setStatusMessage(`${pendingCall.callerName || pendingCall.callerId} is calling you.`);
          return;
        }

        setStatusMessage('Ready to call by user ID.');
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        setAuthError(error.message || 'Unable to load session');
      });

    return () => {
      active = false;

      if (socketRef.current === socket) {
        socket.disconnect();
        socketRef.current = null;
      }
    };
  }, [authSession]);

  useEffect(() => {
    if (!authSession?.token) {
      return undefined;
    }

    const handleVisibilityChange = () => {
      socketRef.current?.updateAppState(
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

      persistAuthSession(session);
      setAuthSession(session);
      setAuthError('');
      setStatusMessage('Connecting direct call session...');
    } catch (error) {
      setAuthError(error.message || 'Unable to parse JWT');
    }
  }

  async function handleCreateDevToken() {
    try {
      const response = await requestDevToken({
        displayName: devDisplayName,
        userId: devUserId,
      });
      const session = createAuthSessionFromToken(response.token);

      setJwtDraft(response.token);
      persistAuthSession(session);
      setAuthSession(session);
      setAuthError('');
      setStatusMessage('Development token issued. Connecting...');
    } catch (error) {
      setAuthError(error.message || 'Unable to create development token');
    }
  }

  async function handleEnablePush() {
    if (!authSession?.token) {
      return;
    }

    try {
      const pushResult = await enableIncomingCallPush({
        onForegroundMessage: (payload) => {
          const notificationBody = payload?.notification?.body || 'Incoming call notification received.';
          setStatusMessage(notificationBody);
        },
      });

      if (!pushResult.enabled) {
        setPushState({
          enabled: false,
          permission: pushResult.permission || pushState.permission,
          pushToken: '',
          reason: pushResult.reason || 'Push permission was not granted.',
          supported: pushResult.supported,
        });
        return;
      }

      await registerPushToken({
        pushToken: pushResult.pushToken,
        token: authSession.token,
      });

      setPushState({
        enabled: true,
        permission: pushResult.permission,
        pushToken: pushResult.pushToken,
        reason: '',
        supported: true,
      });
      setStatusMessage('Push notifications are armed for incoming calls.');
    } catch (error) {
      setPushState((current) => ({
        ...current,
        reason: error.message || 'Unable to enable push notifications',
      }));
    }
  }

  async function handleSignOut() {
    if (authSession?.token && pushState.pushToken) {
      await unregisterPushToken({
        pushToken: pushState.pushToken,
        token: authSession.token,
      }).catch(() => {});
    }

    clearStoredAuthSession();
    setAuthSession(null);
    setJwtDraft('');
    setIncomingCall(null);
    setActiveCall(null);
    setPushState({
      enabled: false,
      permission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
      pushToken: '',
      reason: '',
      supported: typeof window !== 'undefined' && 'Notification' in window,
    });
    resetCallState('Session cleared. Paste another JWT to reconnect.');
  }

  async function handleStartCall(mediaMode) {
    setCallError('');

    if (!calleeUserId.trim()) {
      setCallError('Enter the target user ID first.');
      return;
    }

    try {
      socketRef.current?.send('call-request', {
        calleeUserId: calleeUserId.trim(),
        mediaMode,
      });
      setStatusMessage('Sending call request...');
    } catch (error) {
      setCallError(error.message || 'Unable to send call request');
    }
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
      socketRef.current?.send('accept-call', {
        callId: incomingCall.callId,
      });
      setIncomingCall(null);
    } catch (error) {
      setCallError(error.message || 'Unable to access microphone/camera');
    }
  }

  function handleRejectIncomingCall() {
    if (!incomingCall?.callId) {
      return;
    }

    socketRef.current?.send('reject-call', {
      callId: incomingCall.callId,
      reason: 'rejected',
    });
    resetCallState('Incoming call declined.');
  }

  function handleHangUp() {
    if (!activeCall?.callId) {
      return;
    }

    socketRef.current?.send('end-call', {
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

  const currentUserId = authSession?.userId || sessionInfo?.user?.userId || '';
  const currentDisplayName = authSession?.displayName || sessionInfo?.user?.displayName || '';

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
          <span className="eyebrow">Identity</span>
          <h2>{authSession ? 'Authenticated Session' : 'Connect with JWT'}</h2>

          {authSession ? (
            <>
              <div className="presence-strip direct-call-status-strip">
                <div className="presence-card">
                  <div className="presence-copy">
                    <strong>User ID</strong>
                    <span>{currentUserId}</span>
                  </div>
                </div>
                <div className="presence-card">
                  <div className="presence-copy">
                    <strong>Name</strong>
                    <span>{currentDisplayName}</span>
                  </div>
                </div>
                <div className="presence-card">
                  <div className="presence-copy">
                    <strong>Socket</strong>
                    <span>{connectionState}</span>
                  </div>
                </div>
              </div>

              <div className="button-stack">
                <button className="secondary-button" onClick={handleEnablePush} type="button">
                  Enable Push
                </button>
                <button className="danger-button" onClick={handleSignOut} type="button">
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <>
              <p>Paste a JWT whose `sub` claim maps to the user ID that presence and signaling should use.</p>
              <textarea
                className="composer-input direct-call-token-input"
                onChange={(event) => setJwtDraft(event.target.value)}
                placeholder="Paste signed JWT here"
                value={jwtDraft}
              />
              <button className="primary-button" onClick={handleConnectWithJwt} type="button">
                Connect with JWT
              </button>

              {isDevAuthEnabled() ? (
                <div className="direct-call-dev-auth">
                  <span className="eyebrow">Dev Auth</span>
                  <input
                    className="text-input"
                    onChange={(event) => setDevUserId(event.target.value)}
                    placeholder="user-id"
                    value={devUserId}
                  />
                  <input
                    className="text-input"
                    onChange={(event) => setDevDisplayName(event.target.value)}
                    placeholder="Display name"
                    value={devDisplayName}
                  />
                  <button className="secondary-button" onClick={handleCreateDevToken} type="button">
                    Issue Development Token
                  </button>
                </div>
              ) : null}
            </>
          )}

          {authError ? <p className="feedback error">{authError}</p> : null}
          {callError ? <p className="feedback error">{callError}</p> : null}
        </article>

        <article className="card elevated-card direct-call-stage-card">
          <span className="eyebrow">Call Flow</span>
          <h2>Direct User-to-User Signaling</h2>

          <div className="direct-call-dialer">
            <label className="field-label" htmlFor="callee-user-id">
              Target user ID
            </label>
            <input
              className="text-input"
              id="callee-user-id"
              onChange={(event) => setCalleeUserId(event.target.value)}
              placeholder="user-b"
              value={calleeUserId}
            />
            <div className="button-stack">
              <button
                className="primary-button"
                disabled={!authSession || callPhase !== 'idle'}
                onClick={() => {
                  void handleStartCall('audio');
                }}
                type="button"
              >
                <PhoneCallIcon />
                <span>Audio call</span>
              </button>
              <button
                className="secondary-button"
                disabled={!authSession || callPhase !== 'idle'}
                onClick={() => {
                  void handleStartCall('video');
                }}
                type="button"
              >
                <VideoIcon />
                <span>Video call</span>
              </button>
            </div>
          </div>

          <div className="status-pills">
            <span className="status-pill">State: {callPhase}</span>
            <span className="status-pill">Signal: {connectionState}</span>
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
          <span className="eyebrow">PWA & Push</span>
          <h2>Wake Up The Recipient</h2>
          <p>
            Install this page as a PWA, grant notifications, then register the push token to let the backend
            wake sleeping devices during `call-request`.
          </p>

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

          <div className="direct-call-flow-text">
            <strong>Live flow</strong>
            <p>
              <code>call-request</code>
              {' -> '}
              <code>incoming-call</code>
              {' -> '}
              <code>accept-call</code>
              {' -> '}
              <code>offer/answer</code>
              {' -> '}
              <code>ICE</code>
              {' -> '}
              <code>end-call</code>
            </p>
          </div>

          <div className="direct-call-flow-text">
            <strong>Security gates</strong>
            <p>JWT-authenticated sockets, in-memory rate limiting, disconnect cleanup, and short-lived TURN credentials.</p>
          </div>

          <div className="direct-call-flow-text">
            <strong>Pending calls</strong>
            <p>{sessionInfo?.pendingCalls?.length || 0} waiting requests for this user right now.</p>
          </div>
        </article>
      </section>
    </main>
  );
}

export default DirectCallPage;
