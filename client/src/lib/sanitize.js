const ROOM_ID_PATTERN = /[^A-Z0-9]/g;
const DIRECT_CALL_USER_ID_PATTERN = /[^a-z0-9._-]/g;

export function sanitizeDisplayName(value) {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);

  return normalized || 'Guest';
}

export function sanitizeMessage(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .trim()
    .slice(0, 420);
}

export function sanitizeRoomId(value) {
  return String(value || '')
    .toUpperCase()
    .replace(ROOM_ID_PATTERN, '')
    .slice(0, 6);
}

export function sanitizeDirectCallUserId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(DIRECT_CALL_USER_ID_PATTERN, '')
    .slice(0, 32);
}
