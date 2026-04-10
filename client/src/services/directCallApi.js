import { resolveDirectCallApiOrigin } from '../lib/directCallAuth.js';

async function requestJson(path, { body, method = 'GET', token } = {}) {
  const response = await fetch(`${resolveDirectCallApiOrigin()}${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    method,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }

  return payload;
}

export function requestDevToken({ displayName, userId }) {
  return requestJson('/api/auth/dev-token', {
    body: {
      displayName,
      userId,
    },
    method: 'POST',
  });
}

export function fetchDirectCallSession(token) {
  return requestJson('/api/direct-call/session', {
    token,
  });
}

export function fetchTurnCredentials(token) {
  return requestJson('/api/direct-call/turn-credentials', {
    token,
  });
}

export function registerPushToken({ platform = 'web', pushToken, token }) {
  return requestJson('/api/direct-call/push/register', {
    body: {
      platform,
      token: pushToken,
    },
    method: 'POST',
    token,
  });
}

export function unregisterPushToken({ pushToken, token }) {
  return requestJson('/api/direct-call/push/unregister', {
    body: {
      token: pushToken,
    },
    method: 'POST',
    token,
  });
}

export function notifyIncomingCall({
  callId,
  calleeUserId,
  callerName,
  mediaMode,
  token,
}) {
  return requestJson('/api/direct-call/push/notify', {
    body: {
      callId,
      calleeUserId,
      callerName,
      mediaMode,
    },
    method: 'POST',
    token,
  });
}
