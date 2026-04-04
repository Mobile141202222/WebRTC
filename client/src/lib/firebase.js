import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const requiredEnvKeys = ['databaseURL'];
const missingRequiredKeys = requiredEnvKeys.filter((key) => !firebaseConfig[key]);
const missingOptionalKeys = Object.entries(firebaseConfig)
  .filter(([key, value]) => key !== 'databaseURL' && !value)
  .map(([key]) => key);

let firebaseApp = null;
let database = null;

if (missingRequiredKeys.length === 0) {
  firebaseApp = initializeApp(firebaseConfig);
  database = getDatabase(firebaseApp);
}

export function isFirebaseReady() {
  return Boolean(database);
}

export function getFirebaseConfigError() {
  if (missingRequiredKeys.length === 0) {
    return '';
  }

  return `Firebase config is incomplete. Missing required value: ${missingRequiredKeys.join(', ')}`;
}

export function getFirebaseConfigWarning() {
  if (missingOptionalKeys.length === 0) {
    return '';
  }

  return `Optional Firebase values are still empty: ${missingOptionalKeys.join(', ')}`;
}

export function assertFirebaseConfigured() {
  if (!database) {
    throw new Error(getFirebaseConfigError());
  }

  return database;
}

export { database, firebaseApp };
