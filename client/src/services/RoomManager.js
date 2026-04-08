import {
  get,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
} from 'firebase/database';
import { assertFirebaseConfigured } from '../lib/firebase.js';
import { sanitizeDisplayName, sanitizeMessage } from '../lib/sanitize.js';

const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const EMPTY_ROOM_GRACE_MS = 5 * 60 * 1000;

function roomRef(database, roomId) {
  return ref(database, `rooms/${roomId}`);
}

function roomsRef(database) {
  return ref(database, 'rooms');
}

function participantsRef(database, roomId) {
  return ref(database, `rooms/${roomId}/participants`);
}

function participantRef(database, roomId, participantId) {
  return ref(database, `rooms/${roomId}/participants/${participantId}`);
}

function messagesRef(database, roomId) {
  return ref(database, `rooms/${roomId}/messages`);
}

function buildParticipant({
  participantId,
  displayName,
  peerId = '',
  isHost,
  audioEnabled = true,
  videoEnabled = false,
  screenSharing = false,
}) {
  const now = Date.now();

  return {
    id: participantId,
    joinedAt: now,
    lastSeenAt: now,
    name: sanitizeDisplayName(displayName),
    peerId,
    isHost,
    audioEnabled,
    videoEnabled,
    screenSharing,
  };
}

function buildRoomMetadata({
  hostParticipantId,
  hostPeerId,
  mediaMode = 'voice',
  previousMetadata,
}) {
  const now = Date.now();

  return {
    ...(previousMetadata || {}),
    createdAt: previousMetadata?.createdAt || now,
    expiresAt: now + ROOM_TTL_MS,
    hostParticipantId,
    hostPeerId,
    mediaMode,
    updatedAt: now,
    watchParty: previousMetadata?.watchParty || null,
  };
}

function extendRoomLifetime(database, roomId, now = Date.now()) {
  return update(ref(database, `rooms/${roomId}/metadata`), {
    expiresAt: now + ROOM_TTL_MS,
    updatedAt: now,
  });
}

async function purgeStaleRooms(database) {
  const snapshot = await get(roomsRef(database));

  if (!snapshot.exists()) {
    return;
  }

  const now = Date.now();
  const rooms = snapshot.val() || {};
  const removals = [];

  for (const [nextRoomId, room] of Object.entries(rooms)) {
    const participants = room?.participants || {};
    const metadata = room?.metadata || {};
    const participantCount = Object.keys(participants).length;
    const updatedAt = Number(metadata.updatedAt || metadata.createdAt || 0);
    const expiresAt = Number(metadata.expiresAt || 0);
    const expired = Boolean(expiresAt) && expiresAt < now;
    const abandoned = participantCount === 0 && updatedAt > 0 && now - updatedAt > EMPTY_ROOM_GRACE_MS;

    if (expired || abandoned) {
      removals.push(remove(roomRef(database, nextRoomId)));
    }
  }

  if (removals.length) {
    await Promise.allSettled(removals);
  }
}

export async function createRoom({
  roomId,
  participantId,
  displayName,
  peerId,
  mediaMode = 'voice',
}) {
  const database = assertFirebaseConfigured();
  await purgeStaleRooms(database);
  const existingRoomSnapshot = await get(roomRef(database, roomId));
  const participant = buildParticipant({
    participantId,
    displayName,
    peerId,
    isHost: true,
    videoEnabled: mediaMode === 'video',
  });

  if (!existingRoomSnapshot.exists()) {
    const nextRoom = {
      metadata: buildRoomMetadata({
        hostParticipantId: participantId,
        hostPeerId: peerId,
        mediaMode,
      }),
      participants: {
        [participantId]: participant,
      },
    };

    await set(roomRef(database, roomId), nextRoom);
    return nextRoom;
  }

  const existingRoom = existingRoomSnapshot.val();
  const nextMetadata = buildRoomMetadata({
    hostParticipantId: participantId,
    hostPeerId: peerId,
    mediaMode,
    previousMetadata: existingRoom.metadata,
  });

  await update(roomRef(database, roomId), {
    metadata: nextMetadata,
    [`participants/${participantId}`]: participant,
  });

  return {
    ...existingRoom,
    metadata: nextMetadata,
    participants: {
      ...(existingRoom.participants || {}),
      [participantId]: participant,
    },
  };
}

export async function joinRoom({ roomId, participantId, displayName, peerId }) {
  const database = assertFirebaseConfigured();
  await purgeStaleRooms(database);
  const roomSnapshot = await get(roomRef(database, roomId));

  if (!roomSnapshot.exists()) {
    throw new Error('ไม่พบห้องนี้ หรือห้องถูกปิดไปแล้ว');
  }

  const room = roomSnapshot.val();
  const now = Date.now();

  if (room.metadata?.expiresAt && room.metadata.expiresAt < now) {
    await remove(roomRef(database, roomId));
    throw new Error('ห้องนี้หมดอายุแล้ว กรุณาสร้างห้องใหม่');
  }

  const participant = buildParticipant({
    participantId,
    displayName,
    peerId,
    isHost: false,
    videoEnabled: false,
  });

  await update(roomRef(database, roomId), {
    'metadata/expiresAt': now + ROOM_TTL_MS,
    'metadata/updatedAt': now,
    [`participants/${participantId}`]: participant,
  });

  return {
    ...room,
    participants: {
      ...(room.participants || {}),
      [participantId]: participant,
    },
  };
}

export async function updateParticipantState({ roomId, participantId, patch }) {
  const database = assertFirebaseConfigured();
  const now = Date.now();

  await update(participantRef(database, roomId, participantId), {
    ...patch,
    lastSeenAt: now,
  });

  await extendRoomLifetime(database, roomId, now);
}

export async function updateWatchParty({ roomId, nextState }) {
  const database = assertFirebaseConfigured();
  const now = Date.now();

  await update(ref(database, `rooms/${roomId}/metadata`), {
    watchParty: {
      ...nextState,
      syncedAt: now,
      updatedAt: now,
    },
    expiresAt: now + ROOM_TTL_MS,
    updatedAt: now,
  });
}

export async function clearWatchParty(roomId) {
  const database = assertFirebaseConfigured();
  const now = Date.now();

  await update(ref(database, `rooms/${roomId}/metadata`), {
    watchParty: null,
    expiresAt: now + ROOM_TTL_MS,
    updatedAt: now,
  });
}

export async function registerDisconnectCleanup({ roomId, participantId }) {
  const database = assertFirebaseConfigured();
  const participantDisconnect = onDisconnect(participantRef(database, roomId, participantId));
  const metadataDisconnect = onDisconnect(ref(database, `rooms/${roomId}/metadata`));

  await Promise.all([
    participantDisconnect.remove(),
    metadataDisconnect.update({
      updatedAt: serverTimestamp(),
    }),
  ]);

  return async () => {
    await Promise.allSettled([
      participantDisconnect.cancel(),
      metadataDisconnect.cancel(),
    ]);
  };
}

export function subscribeToRoom(roomId, callback) {
  const database = assertFirebaseConfigured();

  return onValue(roomRef(database, roomId), (snapshot) => {
    callback(snapshot.exists() ? snapshot.val() : null);
  });
}

export function subscribeToParticipants(roomId, callback) {
  const database = assertFirebaseConfigured();

  return onValue(participantsRef(database, roomId), (snapshot) => {
    const nextParticipants = Object.entries(snapshot.val() || {})
      .map(([id, value]) => ({
        id,
        ...value,
      }))
      .sort((left, right) => (left.joinedAt || 0) - (right.joinedAt || 0));

    callback(nextParticipants);
  });
}

export function messagesCollection(roomId) {
  const database = assertFirebaseConfigured();
  return messagesRef(database, roomId);
}

export async function appendMessage({ roomId, participant, text }) {
  const database = assertFirebaseConfigured();
  const cleanMessage = sanitizeMessage(text);

  if (!cleanMessage) {
    return null;
  }

  const nextMessageRef = push(messagesRef(database, roomId));
  const now = Date.now();

  await set(nextMessageRef, {
    participantId: participant.id,
    text: cleanMessage,
    time: now,
    user: sanitizeDisplayName(participant.name),
  });

  await extendRoomLifetime(database, roomId, now);

  return nextMessageRef.key;
}

export async function leaveRoom({ roomId, participantId }) {
  const database = assertFirebaseConfigured();

  await remove(participantRef(database, roomId, participantId));
  await deleteRoomIfEmpty(roomId);
}

export async function deleteRoomIfEmpty(roomId) {
  const database = assertFirebaseConfigured();
  const roomParticipantsSnapshot = await get(participantsRef(database, roomId));
  const participants = roomParticipantsSnapshot.val();

  if (!participants || Object.keys(participants).length === 0) {
    await remove(roomRef(database, roomId));
    return true;
  }

  return false;
}

