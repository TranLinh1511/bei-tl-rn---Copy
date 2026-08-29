import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence, getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Same project as Login.html / index.html (const firebaseConfig / _app).
 * Kept identical so the RN app talks to the exact same Firestore data —
 * no migration needed, per prompt section 6.
 */
const firebaseConfig = {
  apiKey: 'AIzaSyAF016vyl1zZ7dSTpmMZkj8BhCQVwmELl0',
  authDomain: 'deutschbei-tl.firebaseapp.com',
  projectId: 'deutschbei-tl',
  storageBucket: 'deutschbei-tl.firebasestorage.app',
  messagingSenderId: '698311590550',
  appId: '1:698311590550:web:fd9006993fb023641138b7',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// initializeAuth throws if called twice (e.g. Fast Refresh) — fall back to getAuth.
let auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  auth = getAuth(app);
}

const db = getFirestore(app);

export { app, auth, db };
