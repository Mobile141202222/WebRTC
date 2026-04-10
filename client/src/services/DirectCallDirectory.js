import { onValue, ref, remove, serverTimestamp, set, update } from 'firebase/database';
import { assertFirebaseConfigured } from '../lib/firebase.js';
import { sanitizeDirectCallUserId, sanitizeDisplayName } from '../lib/sanitize.js';

function getPath(...segments) {
  return ['directCalls', ...segments].join('/');
}

function getCapabilityLabel(profile, presence) {
  if (presence?.appState === 'foreground') {
    return 'online';
  }

  if (presence?.appState === 'background') {
    return 'background';
  }

  if (profile?.pushEnabled) {
    return 'push-ready';
  }

  return 'offline';
}

function buildEntry({
  contactEntry = null,
  presence = null,
  profile = null,
  recentEntry = null,
  userId,
}) {
  const normalizedUserId = sanitizeDirectCallUserId(userId);

  if (!normalizedUserId) {
    return null;
  }

  const displayName = profile?.displayName || contactEntry?.label || recentEntry?.displayName || normalizedUserId;
  const capability = getCapabilityLabel(profile, presence);
  const lastActivityAt = Math.max(
    Number(profile?.lastActiveAt || 0),
    Number(recentEntry?.lastCalledAt || 0),
    Number(presence?.connectedAt || 0),
  );

  return {
    canReceivePush: Boolean(profile?.pushEnabled),
    capability,
    contactLabel: contactEntry?.label || '',
    displayName,
    favorite: Boolean(contactEntry?.favorite),
    isCallable: capability !== 'offline',
    isOnline: capability === 'online',
    lastActivityAt,
    lastCalledAt: Number(recentEntry?.lastCalledAt || 0),
    lastDirection: recentEntry?.direction || '',
    userId: normalizedUserId,
  };
}

function sortEntries(left, right) {
  if (left.favorite !== right.favorite) {
    return left.favorite ? -1 : 1;
  }

  if (left.isOnline !== right.isOnline) {
    return left.isOnline ? -1 : 1;
  }

  if (left.canReceivePush !== right.canReceivePush) {
    return left.canReceivePush ? -1 : 1;
  }

  if (left.lastActivityAt !== right.lastActivityAt) {
    return right.lastActivityAt - left.lastActivityAt;
  }

  return left.displayName.localeCompare(right.displayName);
}

function normalizeProfiles(value) {
  const profiles = {};

  for (const [userId, profile] of Object.entries(value || {})) {
    const normalizedUserId = sanitizeDirectCallUserId(userId);

    if (!normalizedUserId) {
      continue;
    }

    profiles[normalizedUserId] = {
      ...profile,
      displayName: sanitizeDisplayName(profile?.displayName || normalizedUserId),
      userId: normalizedUserId,
    };
  }

  return profiles;
}

export async function upsertDirectCallProfile({
  pushEnabled = false,
  pushPermission = 'default',
  userId,
  displayName,
}) {
  const db = assertFirebaseConfigured();
  const normalizedUserId = sanitizeDirectCallUserId(userId);

  if (!normalizedUserId) {
    throw new Error('User ID is required');
  }

  await set(ref(db, getPath('profiles', normalizedUserId)), {
    allowsDirectCalls: true,
    displayName: sanitizeDisplayName(displayName || normalizedUserId),
    lastActiveAt: Date.now(),
    pushEnabled,
    pushPermission,
    updatedAt: serverTimestamp(),
    userId: normalizedUserId,
  });
}

export async function updateDirectCallProfileCapabilities({
  pushEnabled,
  pushPermission,
  userId,
}) {
  const db = assertFirebaseConfigured();
  const normalizedUserId = sanitizeDirectCallUserId(userId);

  if (!normalizedUserId) {
    return;
  }

  await update(ref(db, getPath('profiles', normalizedUserId)), {
    lastActiveAt: Date.now(),
    pushEnabled: Boolean(pushEnabled),
    pushPermission: pushPermission || 'default',
    updatedAt: serverTimestamp(),
  });
}

export async function addDirectCallContact({
  ownerUserId,
  contactUserId,
  favorite = false,
  label = '',
}) {
  const db = assertFirebaseConfigured();
  const ownerId = sanitizeDirectCallUserId(ownerUserId);
  const contactId = sanitizeDirectCallUserId(contactUserId);

  if (!ownerId || !contactId) {
    throw new Error('User ID is required');
  }

  await set(ref(db, getPath('contacts', ownerId, contactId)), {
    addedAt: Date.now(),
    favorite,
    label: sanitizeDisplayName(label || contactId),
    userId: contactId,
  });
}

export async function removeDirectCallContact({ ownerUserId, contactUserId }) {
  const db = assertFirebaseConfigured();
  const ownerId = sanitizeDirectCallUserId(ownerUserId);
  const contactId = sanitizeDirectCallUserId(contactUserId);

  if (!ownerId || !contactId) {
    return;
  }

  await remove(ref(db, getPath('contacts', ownerId, contactId)));
}

export async function toggleDirectCallFavorite({
  ownerUserId,
  contactUserId,
  favorite,
}) {
  const db = assertFirebaseConfigured();
  const ownerId = sanitizeDirectCallUserId(ownerUserId);
  const contactId = sanitizeDirectCallUserId(contactUserId);

  if (!ownerId || !contactId) {
    return;
  }

  await update(ref(db, getPath('contacts', ownerId, contactId)), {
    favorite: Boolean(favorite),
    updatedAt: serverTimestamp(),
  });
}

export async function recordDirectCallRecent({
  direction,
  displayName,
  mediaMode,
  otherUserId,
  ownerUserId,
}) {
  const db = assertFirebaseConfigured();
  const ownerId = sanitizeDirectCallUserId(ownerUserId);
  const otherId = sanitizeDirectCallUserId(otherUserId);

  if (!ownerId || !otherId) {
    return;
  }

  await set(ref(db, getPath('recents', ownerId, otherId)), {
    direction: direction || 'unknown',
    displayName: sanitizeDisplayName(displayName || otherId),
    lastCalledAt: Date.now(),
    mediaMode: mediaMode === 'video' ? 'video' : 'audio',
    userId: otherId,
  });
}

export function subscribeToDirectCallDirectory({ userId, callback }) {
  const db = assertFirebaseConfigured();
  const normalizedUserId = sanitizeDirectCallUserId(userId);

  if (!normalizedUserId) {
    callback({
      contacts: [],
      directory: [],
      recents: [],
      selfProfile: null,
    });
    return () => {};
  }

  let profiles = {};
  let contacts = {};
  let presence = {};
  let recents = {};

  function emit() {
    const contactIds = Object.keys(contacts);
    const contactIdSet = new Set(contactIds);
    const contactsList = contactIds
      .map((contactId) =>
        buildEntry({
          contactEntry: contacts[contactId],
          presence: presence[contactId],
          profile: profiles[contactId],
          recentEntry: recents[contactId],
          userId: contactId,
        }))
      .filter(Boolean)
      .sort(sortEntries);

    const recentList = Object.entries(recents)
      .map(([otherUserId, recentEntry]) =>
        buildEntry({
          contactEntry: contacts[otherUserId],
          presence: presence[otherUserId],
          profile: profiles[otherUserId],
          recentEntry,
          userId: otherUserId,
        }))
      .filter(Boolean)
      .sort(sortEntries);

    const directoryList = Object.values(profiles)
      .filter((profile) =>
        profile.userId !== normalizedUserId
        && profile.allowsDirectCalls !== false
        && !contactIdSet.has(profile.userId))
      .map((profile) =>
        buildEntry({
          presence: presence[profile.userId],
          profile,
          recentEntry: recents[profile.userId],
          userId: profile.userId,
        }))
      .filter(Boolean)
      .sort(sortEntries);

    callback({
      contacts: contactsList,
      directory: directoryList,
      recents: recentList,
      selfProfile: profiles[normalizedUserId] || null,
    });
  }

  const unsubscribers = [
    onValue(ref(db, getPath('profiles')), (snapshot) => {
      profiles = normalizeProfiles(snapshot.val());
      emit();
    }),
    onValue(ref(db, getPath('presence')), (snapshot) => {
      presence = snapshot.val() || {};
      emit();
    }),
    onValue(ref(db, getPath('contacts', normalizedUserId)), (snapshot) => {
      contacts = snapshot.val() || {};
      emit();
    }),
    onValue(ref(db, getPath('recents', normalizedUserId)), (snapshot) => {
      recents = snapshot.val() || {};
      emit();
    }),
  ];

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}
