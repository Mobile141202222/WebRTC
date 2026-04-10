import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { firebaseApp } from './firebase.js';

let foregroundMessageUnsubscribe = null;

export async function registerApplicationServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return null;
  }

  return navigator.serviceWorker.register('/firebase-messaging-sw.js');
}

export async function enableIncomingCallPush({
  onForegroundMessage,
  requestPermission = true,
} = {}) {
  if (!firebaseApp) {
    return {
      enabled: false,
      reason: 'Firebase app is not configured',
      supported: false,
    };
  }

  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return {
      enabled: false,
      reason: 'This browser does not support service workers or notifications',
      supported: false,
    };
  }

  const messagingSupported = await isSupported().catch(() => false);

  if (!messagingSupported) {
    return {
      enabled: false,
      reason: 'Firebase messaging is not supported in this browser',
      supported: false,
    };
  }

  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;

  if (!vapidKey) {
    return {
      enabled: false,
      reason: 'VITE_FIREBASE_VAPID_KEY is missing',
      supported: true,
    };
  }

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : requestPermission
      ? await Notification.requestPermission()
      : Notification.permission;

  if (permission !== 'granted') {
    return {
      enabled: false,
      permission,
      supported: true,
    };
  }

  const registration = await registerApplicationServiceWorker();
  const messaging = getMessaging(firebaseApp);

  if (foregroundMessageUnsubscribe) {
    foregroundMessageUnsubscribe();
  }

  foregroundMessageUnsubscribe = onMessage(messaging, (payload) => {
    onForegroundMessage?.(payload);
  });

  const pushToken = await getToken(messaging, {
    serviceWorkerRegistration: registration,
    vapidKey,
  });

  if (!pushToken) {
    return {
      enabled: false,
      permission,
      reason: 'No push token was returned',
      supported: true,
    };
  }

  return {
    enabled: true,
    permission,
    pushToken,
    supported: true,
  };
}

export async function showIncomingCallNotification({ callId, callerName, mediaMode }) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return false;
  }

  const registration = await registerApplicationServiceWorker().catch(() => null);
  const title = `Incoming ${mediaMode === 'video' ? 'video' : 'audio'} call`;
  const body = `${callerName || 'Someone'} is calling you`;
  const data = {
    callId,
    type: 'incoming-call',
    url: `/direct-call?callId=${encodeURIComponent(callId)}`,
  };

  if (registration?.showNotification) {
    await registration.showNotification(title, {
      body,
      data,
      icon: '/favicon.svg',
      renotify: true,
      requireInteraction: true,
      tag: `call-${callId}`,
    });
    return true;
  }

  new Notification(title, {
    body,
  });
  return true;
}
