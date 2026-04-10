import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { firebaseApp } from './firebase.js';

let foregroundMessageUnsubscribe = null;

export async function registerApplicationServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return null;
  }

  return navigator.serviceWorker.register('/firebase-messaging-sw.js');
}

export async function enableIncomingCallPush({ onForegroundMessage } = {}) {
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
    : await Notification.requestPermission();

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
