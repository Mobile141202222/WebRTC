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

function roomRef(database, roomId) {
  return ref(database, `rooms/${roomId}`);
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
    createdAt: previousMetadata?.createdAt || now,
    expiresAt: now + ROOM_TTL_MS,
    hostParticipantId,
    hostPeerId,
    mediaMode,
    updatedAt: now,
  };
}

export async function createRoom({
  roomId,
  participantId,
  displayName,
  peerId,
  mediaMode = 'voice',
}) {
  const database = assertFirebaseConfigured();
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

  await update(ref(database, `rooms/${roomId}/metadata`), {
    expiresAt: now + ROOM_TTL_MS,
    updatedAt: now,
  });
}

export async function registerDisconnectCleanup({ roomId, participantId }) {
  const database = assertFirebaseConfigured();
  const participantDisconnect = onDisconnect(
    participantRef(database, roomId, participantId),
  );
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

  await update(ref(database, `rooms/${roomId}/metadata`), {
    expiresAt: now + ROOM_TTL_MS,
    updatedAt: now,
  });

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

