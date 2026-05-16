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
    { id: 'm5', home: 'BRA', away: 'CRO', kickoff: '2026-06-13T19:00:00Z', stage: 'group', group: 'C', status: 'upcoming', actualScore: null },
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

// === TIKROS 2026 PASAULIO ČEMPIONATO RUNGTYNĖS ===
// 72 grupių etapo rungtynės pagal oficialų FIFA tvarkaraštį
// Laikas saugomas UTC; rodomas Lietuvos laiku (Europe/Vilnius) per formatKickoff
export async function seedWC2026Matches() {
  const matches = [
    // === GROUP A ===
    { id: 'g01', home: 'MEX', away: 'RSA', kickoff: '2026-06-11T19:00:00Z', stage: 'group', group: 'A', status: 'upcoming', actualScore: null },
    { id: 'g02', home: 'KOR', away: 'CZE', kickoff: '2026-06-12T02:00:00Z', stage: 'group', group: 'A', status: 'upcoming', actualScore: null },
    { id: 'g25', home: 'CZE', away: 'RSA', kickoff: '2026-06-18T16:00:00Z', stage: 'group', group: 'A', status: 'upcoming', actualScore: null },
    { id: 'g28', home: 'MEX', away: 'KOR', kickoff: '2026-06-19T01:00:00Z', stage: 'group', group: 'A', status: 'upcoming', actualScore: null },
    { id: 'g51', home: 'CZE', away: 'MEX', kickoff: '2026-06-25T01:00:00Z', stage: 'group', group: 'A', status: 'upcoming', actualScore: null },
    { id: 'g52', home: 'RSA', away: 'KOR', kickoff: '2026-06-25T01:00:00Z', stage: 'group', group: 'A', status: 'upcoming', actualScore: null },

    // === GROUP B ===
    { id: 'g03', home: 'CAN', away: 'BIH', kickoff: '2026-06-12T19:00:00Z', stage: 'group', group: 'B', status: 'upcoming', actualScore: null },
    { id: 'g05', home: 'QAT', away: 'SUI', kickoff: '2026-06-13T19:00:00Z', stage: 'group', group: 'B', status: 'upcoming', actualScore: null },
    { id: 'g26', home: 'SUI', away: 'BIH', kickoff: '2026-06-18T19:00:00Z', stage: 'group', group: 'B', status: 'upcoming', actualScore: null },
    { id: 'g27', home: 'CAN', away: 'QAT', kickoff: '2026-06-18T22:00:00Z', stage: 'group', group: 'B', status: 'upcoming', actualScore: null },
    { id: 'g49', home: 'SUI', away: 'CAN', kickoff: '2026-06-24T19:00:00Z', stage: 'group', group: 'B', status: 'upcoming', actualScore: null },
    { id: 'g50', home: 'BIH', away: 'QAT', kickoff: '2026-06-24T19:00:00Z', stage: 'group', group: 'B', status: 'upcoming', actualScore: null },

    // === GROUP C ===
    { id: 'g06', home: 'BRA', away: 'MAR', kickoff: '2026-06-13T22:00:00Z', stage: 'group', group: 'C', status: 'upcoming', actualScore: null },
    { id: 'g07', home: 'HAI', away: 'SCO', kickoff: '2026-06-14T01:00:00Z', stage: 'group', group: 'C', status: 'upcoming', actualScore: null },
    { id: 'g30', home: 'SCO', away: 'MAR', kickoff: '2026-06-19T22:00:00Z', stage: 'group', group: 'C', status: 'upcoming', actualScore: null },
    { id: 'g31', home: 'BRA', away: 'HAI', kickoff: '2026-06-20T00:30:00Z', stage: 'group', group: 'C', status: 'upcoming', actualScore: null },
    { id: 'g53', home: 'SCO', away: 'BRA', kickoff: '2026-06-24T22:00:00Z', stage: 'group', group: 'C', status: 'upcoming', actualScore: null },
    { id: 'g54', home: 'MAR', away: 'HAI', kickoff: '2026-06-24T22:00:00Z', stage: 'group', group: 'C', status: 'upcoming', actualScore: null },

    // === GROUP D ===
    { id: 'g04', home: 'USA', away: 'PAR', kickoff: '2026-06-13T01:00:00Z', stage: 'group', group: 'D', status: 'upcoming', actualScore: null },
    { id: 'g08', home: 'AUS', away: 'TUR', kickoff: '2026-06-14T04:00:00Z', stage: 'group', group: 'D', status: 'upcoming', actualScore: null },
    { id: 'g29', home: 'USA', away: 'AUS', kickoff: '2026-06-19T19:00:00Z', stage: 'group', group: 'D', status: 'upcoming', actualScore: null },
    { id: 'g32', home: 'TUR', away: 'PAR', kickoff: '2026-06-20T03:00:00Z', stage: 'group', group: 'D', status: 'upcoming', actualScore: null },
    { id: 'g59', home: 'TUR', away: 'USA', kickoff: '2026-06-26T02:00:00Z', stage: 'group', group: 'D', status: 'upcoming', actualScore: null },
    { id: 'g60', home: 'PAR', away: 'AUS', kickoff: '2026-06-26T02:00:00Z', stage: 'group', group: 'D', status: 'upcoming', actualScore: null },

    // === GROUP E ===
    { id: 'g09', home: 'GER', away: 'CUW', kickoff: '2026-06-14T17:00:00Z', stage: 'group', group: 'E', status: 'upcoming', actualScore: null },
    { id: 'g11', home: 'CIV', away: 'ECU', kickoff: '2026-06-14T23:00:00Z', stage: 'group', group: 'E', status: 'upcoming', actualScore: null },
    { id: 'g34', home: 'GER', away: 'CIV', kickoff: '2026-06-20T20:00:00Z', stage: 'group', group: 'E', status: 'upcoming', actualScore: null },
    { id: 'g35', home: 'ECU', away: 'CUW', kickoff: '2026-06-21T00:00:00Z', stage: 'group', group: 'E', status: 'upcoming', actualScore: null },
    { id: 'g55', home: 'CUW', away: 'CIV', kickoff: '2026-06-25T20:00:00Z', stage: 'group', group: 'E', status: 'upcoming', actualScore: null },
    { id: 'g56', home: 'ECU', away: 'GER', kickoff: '2026-06-25T20:00:00Z', stage: 'group', group: 'E', status: 'upcoming', actualScore: null },

    // === GROUP F ===
    { id: 'g10', home: 'NED', away: 'JPN', kickoff: '2026-06-14T20:00:00Z', stage: 'group', group: 'F', status: 'upcoming', actualScore: null },
    { id: 'g12', home: 'SWE', away: 'TUN', kickoff: '2026-06-15T02:00:00Z', stage: 'group', group: 'F', status: 'upcoming', actualScore: null },
    { id: 'g33', home: 'NED', away: 'SWE', kickoff: '2026-06-20T17:00:00Z', stage: 'group', group: 'F', status: 'upcoming', actualScore: null },
    { id: 'g36', home: 'TUN', away: 'JPN', kickoff: '2026-06-21T04:00:00Z', stage: 'group', group: 'F', status: 'upcoming', actualScore: null },
    { id: 'g57', home: 'JPN', away: 'SWE', kickoff: '2026-06-25T23:00:00Z', stage: 'group', group: 'F', status: 'upcoming', actualScore: null },
    { id: 'g58', home: 'TUN', away: 'NED', kickoff: '2026-06-25T23:00:00Z', stage: 'group', group: 'F', status: 'upcoming', actualScore: null },

    // === GROUP G ===
    { id: 'g14', home: 'BEL', away: 'EGY', kickoff: '2026-06-15T19:00:00Z', stage: 'group', group: 'G', status: 'upcoming', actualScore: null },
    { id: 'g16', home: 'IRN', away: 'NZL', kickoff: '2026-06-16T01:00:00Z', stage: 'group', group: 'G', status: 'upcoming', actualScore: null },
    { id: 'g38', home: 'BEL', away: 'IRN', kickoff: '2026-06-21T19:00:00Z', stage: 'group', group: 'G', status: 'upcoming', actualScore: null },
    { id: 'g40', home: 'NZL', away: 'EGY', kickoff: '2026-06-22T01:00:00Z', stage: 'group', group: 'G', status: 'upcoming', actualScore: null },
    { id: 'g63', home: 'EGY', away: 'IRN', kickoff: '2026-06-27T03:00:00Z', stage: 'group', group: 'G', status: 'upcoming', actualScore: null },
    { id: 'g64', home: 'NZL', away: 'BEL', kickoff: '2026-06-27T03:00:00Z', stage: 'group', group: 'G', status: 'upcoming', actualScore: null },

    // === GROUP H ===
    { id: 'g13', home: 'ESP', away: 'CPV', kickoff: '2026-06-15T16:00:00Z', stage: 'group', group: 'H', status: 'upcoming', actualScore: null },
    { id: 'g15', home: 'KSA', away: 'URU', kickoff: '2026-06-15T22:00:00Z', stage: 'group', group: 'H', status: 'upcoming', actualScore: null },
    { id: 'g37', home: 'ESP', away: 'KSA', kickoff: '2026-06-21T16:00:00Z', stage: 'group', group: 'H', status: 'upcoming', actualScore: null },
    { id: 'g39', home: 'URU', away: 'CPV', kickoff: '2026-06-21T22:00:00Z', stage: 'group', group: 'H', status: 'upcoming', actualScore: null },
    { id: 'g61', home: 'CPV', away: 'KSA', kickoff: '2026-06-27T00:00:00Z', stage: 'group', group: 'H', status: 'upcoming', actualScore: null },
    { id: 'g62', home: 'URU', away: 'ESP', kickoff: '2026-06-27T00:00:00Z', stage: 'group', group: 'H', status: 'upcoming', actualScore: null },

    // === GROUP I ===
    { id: 'g17', home: 'FRA', away: 'SEN', kickoff: '2026-06-16T19:00:00Z', stage: 'group', group: 'I', status: 'upcoming', actualScore: null },
    { id: 'g18', home: 'IRQ', away: 'NOR', kickoff: '2026-06-16T22:00:00Z', stage: 'group', group: 'I', status: 'upcoming', actualScore: null },
    { id: 'g42', home: 'FRA', away: 'IRQ', kickoff: '2026-06-22T21:00:00Z', stage: 'group', group: 'I', status: 'upcoming', actualScore: null },
    { id: 'g43', home: 'NOR', away: 'SEN', kickoff: '2026-06-23T00:00:00Z', stage: 'group', group: 'I', status: 'upcoming', actualScore: null },
    { id: 'g65', home: 'NOR', away: 'FRA', kickoff: '2026-06-26T19:00:00Z', stage: 'group', group: 'I', status: 'upcoming', actualScore: null },
    { id: 'g66', home: 'SEN', away: 'IRQ', kickoff: '2026-06-26T19:00:00Z', stage: 'group', group: 'I', status: 'upcoming', actualScore: null },

    // === GROUP J ===
    { id: 'g19', home: 'ARG', away: 'ALG', kickoff: '2026-06-17T01:00:00Z', stage: 'group', group: 'J', status: 'upcoming', actualScore: null },
    { id: 'g20', home: 'AUT', away: 'JOR', kickoff: '2026-06-17T04:00:00Z', stage: 'group', group: 'J', status: 'upcoming', actualScore: null },
    { id: 'g41', home: 'ARG', away: 'AUT', kickoff: '2026-06-22T17:00:00Z', stage: 'group', group: 'J', status: 'upcoming', actualScore: null },
    { id: 'g44', home: 'JOR', away: 'ALG', kickoff: '2026-06-23T03:00:00Z', stage: 'group', group: 'J', status: 'upcoming', actualScore: null },
    { id: 'g71', home: 'ALG', away: 'AUT', kickoff: '2026-06-28T02:00:00Z', stage: 'group', group: 'J', status: 'upcoming', actualScore: null },
    { id: 'g72', home: 'JOR', away: 'ARG', kickoff: '2026-06-28T02:00:00Z', stage: 'group', group: 'J', status: 'upcoming', actualScore: null },

    // === GROUP K ===
    { id: 'g21', home: 'POR', away: 'COD', kickoff: '2026-06-17T17:00:00Z', stage: 'group', group: 'K', status: 'upcoming', actualScore: null },
    { id: 'g24', home: 'UZB', away: 'COL', kickoff: '2026-06-18T02:00:00Z', stage: 'group', group: 'K', status: 'upcoming', actualScore: null },
    { id: 'g45', home: 'POR', away: 'UZB', kickoff: '2026-06-23T17:00:00Z', stage: 'group', group: 'K', status: 'upcoming', actualScore: null },
    { id: 'g48', home: 'COL', away: 'COD', kickoff: '2026-06-24T02:00:00Z', stage: 'group', group: 'K', status: 'upcoming', actualScore: null },
    { id: 'g69', home: 'COL', away: 'POR', kickoff: '2026-06-27T23:30:00Z', stage: 'group', group: 'K', status: 'upcoming', actualScore: null },
    { id: 'g70', home: 'COD', away: 'UZB', kickoff: '2026-06-27T23:30:00Z', stage: 'group', group: 'K', status: 'upcoming', actualScore: null },

    // === GROUP L ===
    { id: 'g22', home: 'ENG', away: 'CRO', kickoff: '2026-06-17T20:00:00Z', stage: 'group', group: 'L', status: 'upcoming', actualScore: null },
    { id: 'g23', home: 'GHA', away: 'PAN', kickoff: '2026-06-17T23:00:00Z', stage: 'group', group: 'L', status: 'upcoming', actualScore: null },
    { id: 'g46', home: 'ENG', away: 'GHA', kickoff: '2026-06-23T20:00:00Z', stage: 'group', group: 'L', status: 'upcoming', actualScore: null },
    { id: 'g47', home: 'PAN', away: 'CRO', kickoff: '2026-06-23T23:00:00Z', stage: 'group', group: 'L', status: 'upcoming', actualScore: null },
    { id: 'g67', home: 'PAN', away: 'ENG', kickoff: '2026-06-27T21:00:00Z', stage: 'group', group: 'L', status: 'upcoming', actualScore: null },
    { id: 'g68', home: 'CRO', away: 'GHA', kickoff: '2026-06-27T21:00:00Z', stage: 'group', group: 'L', status: 'upcoming', actualScore: null },
  ];

  const batch = writeBatch(db);
  matches.forEach((m) => {
    const ref = doc(db, 'matches', m.id);
    batch.set(ref, m);
  });
  await batch.commit();
  return matches.length;
}

// === IŠTRINTI DEMO RUNGTYNES ===
// Naudinga, jei sukurtos demo rungtynės m1-m8 (kurios neturi tikrų komandų)
export async function deleteDemoMatches() {
  const batch = writeBatch(db);
  ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'].forEach((id) => {
    batch.delete(doc(db, 'matches', id));
  });
  await batch.commit();
}
