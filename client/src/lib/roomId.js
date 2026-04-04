const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomId(length = 6) {
  const bytes = crypto.getRandomValues(new Uint32Array(length));

  return Array.from(bytes, (value) => ROOM_ALPHABET[value % ROOM_ALPHABET.length]).join('');
}

export function createParticipantId() {
  return crypto.randomUUID();
}
