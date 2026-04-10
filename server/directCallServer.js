const { URL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { WebSocketServer } = require('ws');
const {
  authenticateHttpRequest,
  createDevToken,
  safeJsonParse,
  verifyJwt,
} = require('./auth');
const { DirectCallStore } = require('./directCallStore');
const { sendPushNotification, isFcmConfigured } = require('./push');
const { SlidingWindowRateLimiter } = require('./rateLimiter');
const { buildIceConfiguration } = require('./turn');

function sendJson(ws, payload) {
  if (!ws || ws.readyState !== 1) {
    return false;
  }

  ws.send(JSON.stringify(payload));
  return true;
}

function sanitizeMediaMode(mediaMode) {
  return mediaMode === 'video' ? 'video' : 'audio';
}

function serializeIncomingCall(call) {
  return {
    callId: call.id,
    callerId: call.callerId,
    callerName: call.callerName,
    mediaMode: call.mediaMode,
    startedAt: call.createdAt,
  };
}

function buildSocketEvent(type, payload = {}) {
  return {
    type,
    ...payload,
  };
}

function authenticateSocket({
  appState,
  authConfig,
  socketContext,
  store,
  token,
  ws,
}) {
  const authContext = verifyJwt(String(token || ''), authConfig);
  const nextSocketContext = {
    displayName: authContext.displayName,
    socketId: socketContext.socketId,
    userId: authContext.userId,
    ws,
  };

  store.registerConnection({
    appState: appState === 'background' ? 'background' : 'foreground',
    displayName: authContext.displayName,
    socketId: socketContext.socketId,
    userId: authContext.userId,
    ws,
  });

  return nextSocketContext;
}

function createDirectCallServer({ app, authConfig, callConfig, httpServer, pushConfig, turnConfig, wsPath }) {
  const store = new DirectCallStore();
  const rateLimiter = new SlidingWindowRateLimiter();
  const requireAuth = authenticateHttpRequest(authConfig);
  const wsServer = new WebSocketServer({
    noServer: true,
  });

  function consumeRateLimit({ limit, socketContext, type, windowMs = 60_000 }) {
    const result = rateLimiter.consume({
      key: `${socketContext.userId}:${type}`,
      limit,
      windowMs,
    });

    if (result.allowed) {
      return true;
    }

    sendJson(socketContext.ws, buildSocketEvent('error', {
      code: 'rate_limited',
      message: `Too many ${type} events`,
      retryAfterMs: result.retryAfterMs,
    }));

    return false;
  }

  function sendToSocketId(socketId, event) {
    if (!socketId) {
      return false;
    }

    const connection = store.getConnection(socketId);

    if (!connection) {
      return false;
    }

    return sendJson(connection.ws, event);
  }

  function sendToUser(userId, event, options = {}) {
    const preferredConnections = store.getPreferredSocketsForUser(
      userId,
      options.excludeSocketIds || [],
    );

    if (preferredConnections.length === 0) {
      return 0;
    }

    let deliveredCount = 0;

    for (const connection of preferredConnections) {
      const delivered = sendJson(connection.ws, event);
      deliveredCount += delivered ? 1 : 0;
    }

    return deliveredCount;
  }

  async function dispatchPushForIncomingCall(call) {
    const pushTokens = store.getPushTokensForUser(call.calleeUserId);

    if (!isFcmConfigured(pushConfig) || pushTokens.length === 0) {
      return {
        attempted: false,
        delivered: 0,
      };
    }

    // Push is best-effort and should never block signaling from continuing.
    const pushResults = await Promise.allSettled(
      pushTokens.map((token) =>
        sendPushNotification({
          appBaseUrl: callConfig.appBaseUrl,
          call,
          pushConfig,
          token,
        }),
      ),
    );
    let delivered = 0;

    for (let index = 0; index < pushResults.length; index += 1) {
      const result = pushResults[index];

      if (result.status === 'fulfilled' && result.value.ok) {
        delivered += 1;
        continue;
      }

      if (result.status === 'fulfilled' && result.value.invalidToken) {
        store.removePushTokenEverywhere(pushTokens[index]);
      }
    }

    return {
      attempted: true,
      delivered,
    };
  }

  async function handleCallRequest(socketContext, message) {
    if (
      !consumeRateLimit({
        limit: callConfig.maxCallRequestsPerMinute,
        socketContext,
        type: 'call-request',
      })
    ) {
      return;
    }

    const calleeUserId = String(message.calleeUserId || '').trim();

    if (!calleeUserId) {
      sendJson(socketContext.ws, buildSocketEvent('error', {
        code: 'invalid_target',
        message: 'calleeUserId is required',
      }));
      return;
    }

    if (calleeUserId === socketContext.userId) {
      sendJson(socketContext.ws, buildSocketEvent('error', {
        code: 'invalid_target',
        message: 'You cannot call yourself',
      }));
      return;
    }

    let call;

    try {
      call = store.createCall({
        calleeUserId,
        callerId: socketContext.userId,
        callerName: socketContext.displayName,
        callerSocketId: socketContext.socketId,
        mediaMode: sanitizeMediaMode(message.mediaMode),
        ringTimeoutMs: callConfig.ringTimeoutMs,
      });
    } catch (error) {
      sendJson(socketContext.ws, buildSocketEvent('reject-call', {
        callId: '',
        reason: 'busy',
        message: error.message,
      }));
      return;
    }

    const incomingCallEvent = buildSocketEvent('incoming-call', serializeIncomingCall(call));
    const deliveredToSockets = sendToUser(calleeUserId, incomingCallEvent);
    const shouldSendPush = deliveredToSockets === 0 || !store.userHasForegroundConnection(calleeUserId);
    const pushResult = shouldSendPush
      ? await dispatchPushForIncomingCall(call)
      : { attempted: false, delivered: 0 };

    sendJson(socketContext.ws, buildSocketEvent('call-request', {
      callId: call.id,
      calleeUserId,
      expiresAt: call.expiresAt,
      mediaMode: call.mediaMode,
      pushDispatched: pushResult.delivered > 0,
      ringing: true,
      socketsNotified: deliveredToSockets,
    }));
  }

  function handleAcceptCall(socketContext, message) {
    if (
      !consumeRateLimit({
        limit: callConfig.maxSignalMessagesPerMinute,
        socketContext,
        type: 'accept-call',
      })
    ) {
      return;
    }

    try {
      const call = store.acceptCall(String(message.callId || '').trim(), {
        socketId: socketContext.socketId,
        userId: socketContext.userId,
      });

      sendToSocketId(call.callerSocketId, buildSocketEvent('accept-call', {
        callId: call.id,
        calleeUserId: call.calleeUserId,
        mediaMode: call.mediaMode,
      }));

      sendToUser(call.calleeUserId, buildSocketEvent('call-picked-up', {
        callId: call.id,
      }), {
        excludeSocketIds: [socketContext.socketId],
      });
    } catch (error) {
      sendJson(socketContext.ws, buildSocketEvent('error', {
        code: 'accept_failed',
        message: error.message,
      }));
    }
  }

  function handleRejectCall(socketContext, message) {
    if (
      !consumeRateLimit({
        limit: callConfig.maxSignalMessagesPerMinute,
        socketContext,
        type: 'reject-call',
      })
    ) {
      return;
    }

    try {
      const finalizedCall = store.rejectCall(String(message.callId || '').trim(), {
        reason: message.reason || 'rejected',
        userId: socketContext.userId,
      });

      if (!finalizedCall) {
        return;
      }

      const rejectEvent = buildSocketEvent('reject-call', {
        callId: finalizedCall.id,
        reason: finalizedCall.reason,
      });

      if (finalizedCall.callerSocketId === socketContext.socketId) {
        if (finalizedCall.calleeSocketId) {
          sendToSocketId(finalizedCall.calleeSocketId, rejectEvent);
        } else {
          sendToUser(finalizedCall.calleeUserId, rejectEvent);
        }
      } else {
        sendToSocketId(finalizedCall.callerSocketId, rejectEvent);
        sendToUser(finalizedCall.calleeUserId, rejectEvent, {
          excludeSocketIds: [socketContext.socketId],
        });
      }
    } catch (error) {
      sendJson(socketContext.ws, buildSocketEvent('error', {
        code: 'reject_failed',
        message: error.message,
      }));
    }
  }

  function handleEndCall(socketContext, message) {
    if (
      !consumeRateLimit({
        limit: callConfig.maxSignalMessagesPerMinute,
        socketContext,
        type: 'end-call',
      })
    ) {
      return;
    }

    try {
      const finalizedCall = store.endCall(String(message.callId || '').trim(), {
        reason: message.reason || 'ended',
        userId: socketContext.userId,
      });

      if (!finalizedCall) {
        return;
      }

      const endEvent = buildSocketEvent('end-call', {
        callId: finalizedCall.id,
        reason: finalizedCall.reason,
      });

      if (finalizedCall.callerSocketId && finalizedCall.callerSocketId !== socketContext.socketId) {
        sendToSocketId(finalizedCall.callerSocketId, endEvent);
      }

      if (finalizedCall.calleeSocketId && finalizedCall.calleeSocketId !== socketContext.socketId) {
        sendToSocketId(finalizedCall.calleeSocketId, endEvent);
      }

      if (!finalizedCall.calleeSocketId) {
        sendToUser(finalizedCall.calleeUserId, endEvent);
      }
    } catch (error) {
      sendJson(socketContext.ws, buildSocketEvent('error', {
        code: 'end_failed',
        message: error.message,
      }));
    }
  }

  function handleWebRtcRelay(socketContext, message, type) {
    if (
      !consumeRateLimit({
        limit: callConfig.maxSignalMessagesPerMinute,
        socketContext,
        type,
      })
    ) {
      return;
    }

    const call = store.getCall(String(message.callId || '').trim());

    if (!call) {
      sendJson(socketContext.ws, buildSocketEvent('error', {
        code: 'call_missing',
        message: 'Call session not found',
      }));
      return;
    }

    // Once a call is accepted, WebRTC frames are pinned to the chosen socket pair.
    const targetSocketId = store.resolveTargetSocketId(
      call,
      socketContext.socketId,
      socketContext.userId,
    );

    if (!targetSocketId) {
      sendJson(socketContext.ws, buildSocketEvent('error', {
        code: 'target_unavailable',
        message: 'The other participant is no longer connected',
      }));
      return;
    }

    if (type === 'webrtc-answer') {
      store.markCallConnected(call.id);
    }

    sendToSocketId(targetSocketId, buildSocketEvent(type, {
      callId: call.id,
      candidate: message.candidate,
      description: message.description,
      fromUserId: socketContext.userId,
      mediaMode: call.mediaMode,
    }));
  }

  function deliverPendingCalls(socketContext) {
    const pendingCalls = store.getPendingIncomingCalls(socketContext.userId);

    for (const call of pendingCalls) {
      // Replaying pending calls lets a PWA opened from push recover the ringing state.
      sendJson(socketContext.ws, buildSocketEvent('incoming-call', serializeIncomingCall(call)));
    }
  }

  function handleSocketMessage(socketContext, message) {
    switch (message.type) {
      case 'presence-update':
        store.updateConnection(socketContext.socketId, {
          appState: message.appState === 'background' ? 'background' : 'foreground',
        });
        return;
      case 'call-request':
        void handleCallRequest(socketContext, message);
        return;
      case 'accept-call':
        handleAcceptCall(socketContext, message);
        return;
      case 'reject-call':
        handleRejectCall(socketContext, message);
        return;
      case 'end-call':
        handleEndCall(socketContext, message);
        return;
      case 'webrtc-offer':
      case 'webrtc-answer':
      case 'webrtc-ice-candidate':
        handleWebRtcRelay(socketContext, message, message.type);
        return;
      default:
        sendJson(socketContext.ws, buildSocketEvent('error', {
          code: 'unknown_event',
          message: `Unsupported event: ${message.type}`,
        }));
    }
  }

  app.get('/api/direct-call/health', (_request, response) => {
    response.json({
      ok: true,
      pushConfigured: isFcmConfigured(pushConfig),
      turnConfigured: Boolean(turnConfig.sharedSecret && turnConfig.turnUrls.length > 0),
      wsPath,
    });
  });

  if (authConfig.allowDevAuth) {
    app.post('/api/auth/dev-token', (request, response) => {
      const userId = String(request.body?.userId || '').trim();
      const displayName = String(request.body?.displayName || userId).trim();

      if (!userId) {
        response.status(400).json({
          error: 'userId is required',
        });
        return;
      }

      try {
        const token = createDevToken({
          displayName,
          userId,
        }, authConfig);

        response.json({
          token,
          user: {
            displayName,
            userId,
          },
        });
      } catch (error) {
        response.status(500).json({
          error: error.message || 'Unable to create dev token',
        });
      }
    });
  }

  app.get('/api/direct-call/session', requireAuth, (request, response) => {
    response.json({
      pendingCalls: store.getPendingIncomingCalls(request.auth.userId).map(serializeIncomingCall),
      pushConfigured: isFcmConfigured(pushConfig),
      turnConfigured: Boolean(turnConfig.sharedSecret && turnConfig.turnUrls.length > 0),
      user: {
        displayName: request.auth.displayName,
        userId: request.auth.userId,
      },
    });
  });

  app.get('/api/direct-call/turn-credentials', requireAuth, (request, response) => {
    response.json(buildIceConfiguration({
      turnConfig,
      userId: request.auth.userId,
    }));
  });

  app.post('/api/direct-call/push/register', requireAuth, (request, response) => {
    const token = String(request.body?.token || '').trim();

    if (!token) {
      response.status(400).json({
        error: 'token is required',
      });
      return;
    }

    store.registerPushToken(request.auth.userId, token, {
      platform: request.body?.platform || 'web',
    });

    response.json({
      ok: true,
    });
  });

  app.post('/api/direct-call/push/unregister', requireAuth, (request, response) => {
    const token = String(request.body?.token || '').trim();

    if (!token) {
      response.status(400).json({
        error: 'token is required',
      });
      return;
    }

    response.json({
      ok: store.unregisterPushToken(request.auth.userId, token),
    });
  });

  app.post('/api/direct-call/push/notify', requireAuth, async (request, response) => {
    const calleeUserId = String(request.body?.calleeUserId || '').trim();

    if (!calleeUserId) {
      response.status(400).json({
        error: 'calleeUserId is required',
      });
      return;
    }

    if (calleeUserId === request.auth.userId) {
      response.status(400).json({
        error: 'You cannot notify yourself',
      });
      return;
    }

    if (!isFcmConfigured(pushConfig)) {
      response.json({
        delivered: 0,
        ok: true,
        reason: 'push_not_configured',
      });
      return;
    }

    const pushTokens = store.getPushTokensForUser(calleeUserId);

    if (pushTokens.length === 0) {
      response.json({
        delivered: 0,
        ok: true,
        reason: 'no_registered_push_tokens',
      });
      return;
    }

    const call = {
      calleeUserId,
      callerId: request.auth.userId,
      callerName: String(request.body?.callerName || request.auth.displayName).trim() || request.auth.displayName,
      id: String(request.body?.callId || randomUUID()).trim(),
      mediaMode: sanitizeMediaMode(request.body?.mediaMode),
    };

    const pushResults = await Promise.allSettled(
      pushTokens.map((token) =>
        sendPushNotification({
          appBaseUrl: callConfig.appBaseUrl,
          call,
          pushConfig,
          token,
        })),
    );
    let delivered = 0;

    for (let index = 0; index < pushResults.length; index += 1) {
      const result = pushResults[index];

      if (result.status === 'fulfilled' && result.value.ok) {
        delivered += 1;
        continue;
      }

      if (result.status === 'fulfilled' && result.value.invalidToken) {
        store.removePushTokenEverywhere(pushTokens[index]);
      }
    }

    response.json({
      delivered,
      ok: true,
      tokens: pushTokens.length,
    });
  });

  const expirationSweepId = setInterval(() => {
    const expiredCalls = store.expireCalls();

    for (const call of expiredCalls) {
      sendToSocketId(call.callerSocketId, buildSocketEvent('call-timeout', {
        callId: call.id,
      }));
      const endEvent = buildSocketEvent('end-call', {
        callId: call.id,
        reason: 'timeout',
      });

      if (call.calleeSocketId) {
        sendToSocketId(call.calleeSocketId, endEvent);
      } else {
        sendToUser(call.calleeUserId, endEvent);
      }
    }
  }, 5_000);

  expirationSweepId.unref?.();

  httpServer.on('close', () => {
    clearInterval(expirationSweepId);
  });

  httpServer.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    if (requestUrl.pathname !== wsPath) {
      return;
    }

    console.log(`[direct-call] upgrade request for ${requestUrl.pathname} from ${request.headers.origin || 'unknown-origin'}`);

    wsServer.handleUpgrade(request, socket, head, (ws) => {
      wsServer.emit('connection', ws, request);
    });
  });

  wsServer.on('connection', (ws, request) => {
    const socketId = randomUUID();
    let socketContext = null;
    console.log(`[direct-call] socket connected ${socketId}`);
    const requestUrl = new URL(request?.url || wsPath, 'http://localhost');
    const initialToken = requestUrl.searchParams.get('token') || '';
    const initialAppState = requestUrl.searchParams.get('appState') || 'foreground';
    const authTimeoutId = setTimeout(() => {
      if (!socketContext) {
        console.warn(`[direct-call] auth timeout ${socketId}`);
        ws.close(4401, 'Authentication timeout');
      }
    }, 8_000);

    if (initialToken) {
      try {
        socketContext = authenticateSocket({
          appState: initialAppState,
          authConfig,
          socketContext: { socketId },
          store,
          token: initialToken,
          ws,
        });
        clearTimeout(authTimeoutId);
        console.log(`[direct-call] auth success ${socketId} user=${socketContext.userId} via=query`);

        sendJson(ws, buildSocketEvent('auth-success', {
          socketId,
          user: {
            displayName: socketContext.displayName,
            userId: socketContext.userId,
          },
        }));
        deliverPendingCalls(socketContext);
      } catch (error) {
        console.warn(`[direct-call] auth failed ${socketId}: ${error.message || 'Authentication failed'}`);
        ws.close(4401, error.message || 'Authentication failed');
      }
    }

    ws.on('message', (rawMessage) => {
      console.log(`[direct-call] message received ${socketId} bytes=${rawMessage.length}`);
      const message = safeJsonParse(rawMessage.toString('utf8'));

      if (!message || typeof message !== 'object') {
        sendJson(ws, buildSocketEvent('error', {
          code: 'invalid_json',
          message: 'Message must be valid JSON',
        }));
        return;
      }

      if (!socketContext) {
        if (message.type !== 'auth') {
          console.warn(`[direct-call] auth required before event ${message.type} on ${socketId}`);
          ws.close(4401, 'Authentication required');
          return;
        }

        try {
          // The socket is inert until a signed JWT binds it to a concrete user ID.
          socketContext = authenticateSocket({
            appState: message.appState,
            authConfig,
            socketContext: { socketId },
            store,
            token: message.token,
            ws,
          });
          clearTimeout(authTimeoutId);
          console.log(`[direct-call] auth success ${socketId} user=${socketContext.userId} via=message`);

          sendJson(ws, buildSocketEvent('auth-success', {
            socketId,
            user: {
              displayName: socketContext.displayName,
              userId: socketContext.userId,
            },
          }));
          deliverPendingCalls(socketContext);
        } catch (error) {
          console.warn(`[direct-call] auth failed ${socketId}: ${error.message || 'Authentication failed'}`);
          ws.close(4401, error.message || 'Authentication failed');
        }

        return;
      }

      handleSocketMessage(socketContext, message);
    });

    ws.on('close', (code, reasonBuffer) => {
      clearTimeout(authTimeoutId);
      const reason = reasonBuffer?.toString?.('utf8') || '';
      console.log(`[direct-call] socket closed ${socketId} code=${code} reason=${reason || 'n/a'}`);

      const { disconnectedCalls } = store.unregisterConnection(socketId);

      for (const call of disconnectedCalls) {
        const endEvent = buildSocketEvent('end-call', {
          callId: call.id,
          reason: 'disconnect',
        });

        if (call.callerSocketId && call.callerSocketId !== socketId) {
          sendToSocketId(call.callerSocketId, endEvent);
        }

        if (call.calleeSocketId && call.calleeSocketId !== socketId) {
          sendToSocketId(call.calleeSocketId, endEvent);
        }

        if (!call.calleeSocketId) {
          sendToUser(call.calleeUserId, endEvent);
        }
      }
    });

    ws.on('error', (error) => {
      console.error(`[direct-call] socket error ${socketId}:`, error);
    });
  });
}

module.exports = {
  createDirectCallServer,
};
