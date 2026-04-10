const AUTH_STORAGE_KEY = 'roomkit-direct-call-auth';

function normalizeOrigin(origin) {
  return String(origin || '').replace(/\/+$/g, '');
}

export function decodeJwtPayload(token) {
  const [, encodedPayload = ''] = String(token || '').split('.');

  if (!encodedPayload) {
    throw new Error('JWT token is malformed');
  }

  const normalizedPayload = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalizedPayload.length % 4 === 0
    ? ''
    : '='.repeat(4 - (normalizedPayload.length % 4));
  const payloadText = window.atob(`${normalizedPayload}${padding}`);
  const payload = JSON.parse(payloadText);
  const userId = String(payload.sub || payload.userId || '').trim();

  if (!userId) {
    throw new Error('JWT payload must include sub');
  }

  return {
    claims: payload,
    displayName: String(payload.name || payload.displayName || userId),
    userId,
  };
}

export function createAuthSessionFromToken(token) {
  const trimmedToken = String(token || '').trim();
  const payload = decodeJwtPayload(trimmedToken);

  return {
    displayName: payload.displayName,
    token: trimmedToken,
    userId: payload.userId,
  };
}

export function loadStoredAuthSession() {
  const storedValue = localStorage.getItem(AUTH_STORAGE_KEY);

  if (!storedValue) {
    return null;
  }

  try {
    return JSON.parse(storedValue);
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
}

export function persistAuthSession(session) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredAuthSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function isDevAuthEnabled() {
  return import.meta.env.VITE_ALLOW_DEV_AUTH === 'true';
}

export function resolveDirectCallApiOrigin() {
  const explicitOrigin = normalizeOrigin(import.meta.env.VITE_DIRECT_CALL_API_ORIGIN);

  if (explicitOrigin) {
    return explicitOrigin;
  }

  const secureOverride = import.meta.env.VITE_DIRECT_CALL_SECURE;
  const secure = secureOverride === 'true'
    ? true
    : secureOverride === 'false'
      ? false
      : window.location.protocol === 'https:';
  const host = import.meta.env.VITE_DIRECT_CALL_HOST
    || import.meta.env.VITE_PEER_HOST
    || window.location.hostname;
  const port = String(
    import.meta.env.VITE_DIRECT_CALL_PORT
    || import.meta.env.VITE_PEER_PORT
    || (secure ? 443 : 3001),
  );
  const protocol = secure ? 'https:' : 'http:';
  const isDefaultPort = (secure && port === '443') || (!secure && port === '80');

  return `${protocol}//${host}${isDefaultPort ? '' : `:${port}`}`;
}

export function resolveDirectCallWebSocketUrl() {
  const apiOrigin = resolveDirectCallApiOrigin();
  const wsPath = import.meta.env.VITE_DIRECT_CALL_WS_PATH || '/ws/direct-call';
  const nextUrl = new URL(wsPath, apiOrigin);

  nextUrl.protocol = nextUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return nextUrl.toString();
}
