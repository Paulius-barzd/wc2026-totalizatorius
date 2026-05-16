import { initializeApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';

// === FIREBASE CONFIG ===
// Visa konfigūracija imama iš environment kintamųjų (.env arba Netlify)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// === AUTH HELPERS ===

// Spalvų paletė vartotojo avatarui
const AVATAR_COLORS = [
  '#0e6b47', '#b8860b', '#0a2c4e', '#c8302e',
  '#2563eb', '#dd6b20', '#0891b2', '#7c3aed',
];

export async function registerUser(email, password, username, fullName, companyId, companyName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;

  const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  const avatarLetter = (fullName || username).trim()[0].toUpperCase();

  await updateProfile(cred.user, { displayName: username });

  // Sukurti vartotojo profilį Firestore
  await setDoc(doc(db, 'users', uid), {
    uid,
    email,
    username,
    fullName,
    avatarLetter,
    avatarColor,
    companyId: companyId || null, // null = "Be įmonės"
    companyName: companyName || null,
    isAdmin: false, // Admin teises galima suteikti tik per Firebase Console
    createdAt: serverTimestamp(),
  });

  return cred.user;
}

export function loginUser(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logoutUser() {
  return signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// === USER PROFILE ===

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}

// === PREDICTIONS ===

export function savePrediction(uid, matchId, home, away) {
  const id = `${uid}_${matchId}`;
  return setDoc(doc(db, 'predictions', id), {
    userId: uid,
    matchId,
    home,
    away,
    submittedAt: serverTimestamp(),
  });
}

// === TOURNAMENT BETS ===

export function saveTournamentBet(uid, data) {
  return setDoc(doc(db, 'tournamentBets', uid), {
    userId: uid,
    champion: data.champion || null,
    bestPlayer: data.bestPlayer || '',
    topScorer: data.topScorer || '',
    bestGoalkeeper: data.bestGoalkeeper || '',
    bestYoungPlayer: data.bestYoungPlayer || '',
    submittedAt: serverTimestamp(),
  });
}

export async function getTournamentBet(uid) {
  const snap = await getDoc(doc(db, 'tournamentBets', uid));
  return snap.exists() ? snap.data() : null;
}

// === REAL-TIME LISTENERS ===

export function listenToMatches(callback) {
  return onSnapshot(collection(db, 'matches'), (snap) => {
    const matches = [];
    snap.forEach((d) => matches.push({ id: d.id, ...d.data() }));
    // Rūšiuoti pagal kickoff laiką
    matches.sort((a, b) => (a.kickoff || '').localeCompare(b.kickoff || ''));
    callback(matches);
  });
}

export function listenToUserPredictions(uid, callback) {
  const q = query(collection(db, 'predictions'), where('userId', '==', uid));
  return onSnapshot(q, (snap) => {
    const predictions = {};
    snap.forEach((d) => {
      const data = d.data();
      predictions[data.matchId] = { home: data.home, away: data.away };
    });
    callback(predictions);
  });
}

export function listenToAllPredictions(callback) {
  return onSnapshot(collection(db, 'predictions'), (snap) => {
    const all = [];
    snap.forEach((d) => all.push({ id: d.id, ...d.data() }));
    callback(all);
  });
}

export function listenToUsers(callback) {
  return onSnapshot(collection(db, 'users'), (snap) => {
    const users = [];
    snap.forEach((d) => users.push({ id: d.id, ...d.data() }));
    callback(users);
  });
}

export function listenToCompanies(callback) {
  return onSnapshot(collection(db, 'companies'), (snap) => {
    const companies = [];
    snap.forEach((d) => companies.push({ id: d.id, ...d.data() }));
    // Rūšiuoti pagal pavadinimą
    companies.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'lt'));
    callback(companies);
  });
}

// === ADMIN FUNCTIONS ===

export function updateMatch(matchId, updates) {
  return setDoc(doc(db, 'matches', matchId), updates, { merge: true });
}

export async function seedDemoMatches() {
  const matches = [
    { id: 'm1', home: 'MEX', away: 'POR', kickoff: '2026-06-11T20:00:00Z', stage: 'group', group: 'A', status: 'upcoming', actualScore: null },
    { id: 'm2', home: 'CAN', away: 'KOR', kickoff: '2026-06-12T18:00:00Z', stage: 'group', group: 'A', status: 'upcoming', actualScore: null },
    { id: 'm3', home: 'USA', away: 'ESP', kickoff: '2026-06-12T20:00:00Z', stage: 'group', group: 'B', status: 'upcoming', actualScore: null },
    { id: 'm4', home: 'GER', away: 'JPN', kickoff: '2026-06-13T16:00:00Z', stage: 'group', group: 'B', status: 'upcoming', actualScore: null },
    { id: 'm5', home: 'BRA', away: 'ITA', kickoff: '2026-06-13T19:00:00Z', stage: 'group', group: 'C', status: 'upcoming', actualScore: null },
    { id: 'm6', home: 'CRO', away: 'NED', kickoff: '2026-06-14T18:00:00Z', stage: 'group', group: 'C', status: 'upcoming', actualScore: null },
    { id: 'm7', home: 'ARG', away: 'FRA', kickoff: '2026-06-14T21:00:00Z', stage: 'group', group: 'D', status: 'upcoming', actualScore: null },
    { id: 'm8', home: 'ENG', away: 'BEL', kickoff: '2026-06-15T17:00:00Z', stage: 'group', group: 'D', status: 'upcoming', actualScore: null },
  ];

  const batch = writeBatch(db);
  matches.forEach((m) => {
    const ref = doc(db, 'matches', m.id);
    batch.set(ref, m);
  });
  await batch.commit();
}
