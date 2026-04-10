const path = require('node:path');

function parseList(value, fallback = []) {
  if (!value) {
    return fallback;
  }

  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePrivateKey(value) {
  if (!value) {
    return '';
  }

  return String(value).replace(/\\n/g, '\n');
}

const buildDirectory = path.join(__dirname, '..', 'client', 'dist');
const allowedOrigins = parseList(process.env.CLIENT_ORIGIN, ['http://localhost:5173']);

const config = {
  buildDirectory,
  clientOrigin: allowedOrigins[0],
  directCallWsPath: process.env.DIRECT_CALL_WS_PATH || '/ws/direct-call',
  peerPath: process.env.PEER_PATH || '/peerjs',
  serverPort: parseNumber(process.env.PORT, 3001),
  allowedOrigins,
  auth: {
    audience: process.env.AUTH_JWT_AUDIENCE || '',
    issuer: process.env.AUTH_JWT_ISSUER || '',
    jwtAlgorithm: process.env.AUTH_JWT_ALGORITHM || 'HS256',
    jwtPublicKey: normalizePrivateKey(process.env.AUTH_JWT_PUBLIC_KEY),
    jwtSecret: process.env.AUTH_JWT_SECRET || '',
    allowDevAuth: parseBoolean(process.env.ALLOW_INSECURE_DEV_AUTH, false),
    devTokenSecret: process.env.DEV_AUTH_JWT_SECRET || process.env.AUTH_JWT_SECRET || '',
    devTokenTtlSeconds: parseNumber(process.env.DEV_AUTH_JWT_TTL_SECONDS, 60 * 60 * 8),
  },
  calls: {
    appBaseUrl: process.env.APP_BASE_URL || allowedOrigins[0] || 'http://localhost:5173',
    maxCallRequestsPerMinute: parseNumber(process.env.MAX_CALL_REQUESTS_PER_MINUTE, 6),
    maxSignalMessagesPerMinute: parseNumber(process.env.MAX_SIGNAL_MESSAGES_PER_MINUTE, 180),
    ringTimeoutMs: parseNumber(process.env.CALL_RING_TIMEOUT_MS, 30_000),
  },
  push: {
    appName: process.env.PUSH_APP_NAME || 'RoomKit Direct Calling',
    fcmClientEmail: process.env.FCM_CLIENT_EMAIL || '',
    fcmPrivateKey: normalizePrivateKey(process.env.FCM_PRIVATE_KEY),
    fcmProjectId: process.env.FCM_PROJECT_ID || '',
    notificationIcon: process.env.PUSH_NOTIFICATION_ICON || '/favicon.svg',
  },
  turn: {
    sharedSecret: process.env.TURN_SHARED_SECRET || '',
    stunUrls: parseList(process.env.STUN_URLS, ['stun:stun.l.google.com:19302']),
    transportPolicy: process.env.TURN_TRANSPORT_POLICY || 'all',
    ttlSeconds: parseNumber(process.env.TURN_TTL_SECONDS, 600),
    turnUrls: parseList(process.env.TURN_URLS),
  },
};

module.exports = {
  config,
  parseBoolean,
  parseList,
};
