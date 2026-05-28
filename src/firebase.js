import { initializeApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  deleteUser,
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
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
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

// Turnyro pradžios timestamp - po šio momento tournamentBets nebegalima keisti.
// Turi sutapti su firestore.rules patikra (timestamp.date(2026, 6, 11) = 2026-06-11 00:00 UTC).
export const TOURNAMENT_LOCK_TIME = new Date('2026-06-11T00:00:00Z').getTime();

// === AUTH HELPERS ===

// Spalvų paletė vartotojo avatarui
// VMG brand-aligned avatar paletė - visi tonai iš firminės spalvų gamos
const AVATAR_COLORS = [
  '#54130E', // CRIMSON
  '#6A1107', // RUBY
  '#441514', // CURRANT
  '#8B2D22', // šviesesnė CRIMSON
  '#D1A974', // WOOD
  '#845641', // STEM
  '#A04942', // medium ruby (70% tint)
  '#B86344', // wood-ish brown
];

export async function registerUser(email, password, username, fullName, companyId, companyName, companyCode) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;

  // Jei profilio sukūrimas (updateProfile arba setDoc) nepavyks, ištrinti auth user'į,
  // kad neliktų "orphan" Auth įrašo be Firestore profilio (kuris vėliau sukeltų infinite loading).
  try {
    const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    const avatarLetter = (fullName || username).trim()[0].toUpperCase();

    await updateProfile(cred.user, { displayName: username });

    // PUBLIC dalis - matoma visiems prisijungusiems (reikalinga lyderlentei, ranking'ams)
    await setDoc(doc(db, 'users', uid), {
      uid,
      username,
      avatarLetter,
      avatarColor,
      companyId: companyId || null, // null = "Be įmonės"
      companyName: companyName || null,
      companyCode: companyCode || null,
      isAdmin: false, // Admin teises galima suteikti tik per Firebase Console
      createdAt: serverTimestamp(),
    });

    // PRIVATE dalis - email ir fullName matomi tik savininkui ir admin'ui
    await setDoc(doc(db, 'users_private', uid), {
      uid,
      email,
      fullName,
      createdAt: serverTimestamp(),
    });

    return cred.user;
  } catch (err) {
    // Rollback: pašalinti dalinai sukurtą Firestore profilį + auth user'į
    try { await deleteDoc(doc(db, 'users', uid)); } catch (_) {}
    try { await deleteDoc(doc(db, 'users_private', uid)); } catch (_) {}
    try {
      await deleteUser(cred.user);
    } catch (_) {
      // Jei rollback'as nepavyko (pvz., reikia reauth), tylim - originali klaida svarbesnė
    }
    throw err;
  }
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
  const publicSnap = await getDoc(doc(db, 'users', uid));
  if (!publicSnap.exists()) return null;
  const publicData = publicSnap.data();

  // Skaityti privatų doc'ą (email/fullName). Owner gali skaityti pagal Firestore Rules.
  let privateData = {};
  try {
    const privateSnap = await getDoc(doc(db, 'users_private', uid));
    if (privateSnap.exists()) {
      privateData = privateSnap.data();
    } else if (publicData.email || publicData.fullName) {
      // Migracija: senos schemos vartotojas turi email/fullName public docs.
      // Perkelti į private + ištrinti iš public. Vyksta vieną kartą per vartotoją.
      const migrationData = {
        uid,
        email: publicData.email || null,
        fullName: publicData.fullName || null,
        migratedAt: serverTimestamp(),
      };
      try {
        await setDoc(doc(db, 'users_private', uid), migrationData);
        await updateDoc(doc(db, 'users', uid), {
          email: deleteField(),
          fullName: deleteField(),
        });
        privateData = { email: migrationData.email, fullName: migrationData.fullName };
      } catch (migErr) {
        // Migracija nepavyko - leisti login'tis, naudoti seną public data kaip fallback
        console.warn('User private migration failed:', migErr);
        privateData = {
          email: publicData.email || null,
          fullName: publicData.fullName || null,
        };
      }
    }
  } catch (err) {
    console.warn('Failed to read users_private:', err);
  }

  return { ...publicData, ...privateData };
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

// === TOURNAMENT RESULTS (admin) ===

const RESULTS_DOC_ID = 'wc2026';

export function saveTournamentResults(data) {
  return setDoc(doc(db, 'tournamentResults', RESULTS_DOC_ID), {
    champion: data.champion || null,
    bestPlayer: (data.bestPlayer || '').trim(),
    topScorer: (data.topScorer || '').trim(),
    bestGoalkeeper: (data.bestGoalkeeper || '').trim(),
    bestYoungPlayer: (data.bestYoungPlayer || '').trim(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export function listenToTournamentResults(callback) {
  return onSnapshot(doc(db, 'tournamentResults', RESULTS_DOC_ID), (snap) => {
    callback(snap.exists() ? snap.data() : null);
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

// Tik admin'ui - users_private kolekcija (email, fullName). Skaityti pagal Firestore Rules
// leidžiama tik owner'iui arba admin'ui. Kiti vartotojai gaus permission-denied klaidą.
export function listenToUsersPrivate(callback) {
  return onSnapshot(collection(db, 'users_private'), (snap) => {
    const map = {};
    snap.forEach((d) => { map[d.id] = d.data(); });
    callback(map);
  }, (err) => {
    // Klaida - turbūt ne admin. Tylim, callback gauna tuščią objektą.
    console.warn('listenToUsersPrivate denied:', err.code);
    callback({});
  });
}

// Admin funkcija - migruoti VISŲ vartotojų email/fullName iš users į users_private.
// Naudinga jei buvo daug senos schemos vartotojų prieš deploy'ą.
// Naujieji vartotojai jau registruojami su nauja schema automatiškai.
export async function migrateUsersToPrivateSchema() {
  const usersSnap = await getDocs(collection(db, 'users'));
  let migrated = 0;
  const batch = writeBatch(db);

  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    if (!data.email && !data.fullName) continue; // jau migruotas arba nebuvo PII

    batch.set(doc(db, 'users_private', userDoc.id), {
      uid: userDoc.id,
      email: data.email || null,
      fullName: data.fullName || null,
      migratedAt: serverTimestamp(),
    }, { merge: true });

    batch.update(doc(db, 'users', userDoc.id), {
      email: deleteField(),
      fullName: deleteField(),
    });

    migrated++;
  }

  if (migrated > 0) await batch.commit();
  return migrated;
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

// Visų tournamentBets listener'is - reikalingas taškų skaičiavimui per visus dalyvius
export function listenToAllTournamentBets(callback) {
  return onSnapshot(collection(db, 'tournamentBets'), (snap) => {
    const bets = [];
    snap.forEach((d) => bets.push({ id: d.id, ...d.data() }));
    callback(bets);
  });
}

// === ADMIN FUNCTIONS ===

export function updateMatch(matchId, updates) {
  return setDoc(doc(db, 'matches', matchId), updates, { merge: true });
}

// === COMPANIES (admin) ===

// Normalizuoti trumpinį - tik raidės/skaičiai didžiosiomis, max 6 simboliai
function normalizeCompanyCode(code) {
  if (!code) return null;
  const cleaned = code.trim().toUpperCase().slice(0, 6);
  return cleaned || null;
}

export async function createCompany(name, code) {
  const trimmedName = (name || '').trim();
  if (!trimmedName) throw new Error('Įmonės pavadinimas negali būti tuščias');
  const ref = await addDoc(collection(db, 'companies'), {
    name: trimmedName,
    code: normalizeCompanyCode(code),
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateCompany(companyId, name, code) {
  const trimmedName = (name || '').trim();
  if (!trimmedName) throw new Error('Įmonės pavadinimas negali būti tuščias');
  const normalizedCode = normalizeCompanyCode(code);
  await updateDoc(doc(db, 'companies', companyId), {
    name: trimmedName,
    code: normalizedCode,
  });

  // Sinchronizuoti companyName + companyCode visiems šios įmonės vartotojams
  const q = query(collection(db, 'users'), where('companyId', '==', companyId));
  const snap = await getDocs(q);
  if (!snap.empty) {
    const batch = writeBatch(db);
    snap.forEach((u) => batch.update(doc(db, 'users', u.id), {
      companyName: trimmedName,
      companyCode: normalizedCode,
    }));
    await batch.commit();
  }
}

// Ištrinti įmonę galima tik jei joje nėra vartotojų.
export async function deleteCompany(companyId) {
  const q = query(collection(db, 'users'), where('companyId', '==', companyId));
  const snap = await getDocs(q);
  if (!snap.empty) {
    throw new Error(`Negalima ištrinti - įmonė turi ${snap.size} dalyvių. Pirma juos perskirk.`);
  }
  await deleteDoc(doc(db, 'companies', companyId));
}

// === USER ADMIN TEISĖS ===

export function setUserAdmin(uid, isAdmin) {
  return updateDoc(doc(db, 'users', uid), { isAdmin: Boolean(isAdmin) });
}

// Pakeisti vartotojo įmonę (perskirti į kitą arba pašalinti)
export function setUserCompany(uid, companyId, companyName, companyCode) {
  return updateDoc(doc(db, 'users', uid), {
    companyId: companyId || null,
    companyName: companyName || null,
    companyCode: companyCode || null,
  });
}

export async function seedDemoMatches() {
  // 8 demo rungtynės - po vieną iš skirtingų grupių, su teisingomis PFČ 2026 komandomis.
  // Naudoti testavimui prieš įkeliant visas 72 tikras rungtynes.
  const matches = [
    { id: 'm1', home: 'MEX', away: 'RSA', kickoff: '2026-06-11T20:00:00Z', stage: 'group', group: 'A', status: 'upcoming', actualScore: null },
    { id: 'm2', home: 'CAN', away: 'BIH', kickoff: '2026-06-12T18:00:00Z', stage: 'group', group: 'B', status: 'upcoming', actualScore: null },
    { id: 'm3', home: 'BRA', away: 'MAR', kickoff: '2026-06-12T20:00:00Z', stage: 'group', group: 'C', status: 'upcoming', actualScore: null },
    { id: 'm4', home: 'USA', away: 'PAR', kickoff: '2026-06-13T16:00:00Z', stage: 'group', group: 'D', status: 'upcoming', actualScore: null },
    { id: 'm5', home: 'GER', away: 'CUW', kickoff: '2026-06-13T19:00:00Z', stage: 'group', group: 'E', status: 'upcoming', actualScore: null },
    { id: 'm6', home: 'NED', away: 'JPN', kickoff: '2026-06-14T18:00:00Z', stage: 'group', group: 'F', status: 'upcoming', actualScore: null },
    { id: 'm7', home: 'ARG', away: 'ALG', kickoff: '2026-06-14T21:00:00Z', stage: 'group', group: 'J', status: 'upcoming', actualScore: null },
    { id: 'm8', home: 'ENG', away: 'CRO', kickoff: '2026-06-15T17:00:00Z', stage: 'group', group: 'L', status: 'upcoming', actualScore: null },
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

// === PFČ 2026 KNOCKOUT ETAPO STRUKTŪRA ===
// 32 match'ai (16 R32 + 8 R16 + 4 ¼ + 2 ½ + 1 dėl 3 vietos + 1 finalas).
// Komandos null - admin'as priskirs po grupių etapo, arba API sync užpildys.
// Datos pagal oficialų FIFA tvarkaraštį (UTC).
export async function seedKnockoutStructure() {
  const make = (id, kickoff, stage) => ({
    id, home: null, away: null, kickoff, stage, group: null, status: 'upcoming', actualScore: null,
  });
  const matches = [
    // Round of 32 (k01-k16): 2026-06-28 → 2026-07-03
    make('k01', '2026-06-28T16:00:00Z', 'round_of_32'),
    make('k02', '2026-06-28T20:00:00Z', 'round_of_32'),
    make('k03', '2026-06-29T16:00:00Z', 'round_of_32'),
    make('k04', '2026-06-29T20:00:00Z', 'round_of_32'),
    make('k05', '2026-06-30T16:00:00Z', 'round_of_32'),
    make('k06', '2026-06-30T20:00:00Z', 'round_of_32'),
    make('k07', '2026-07-01T16:00:00Z', 'round_of_32'),
    make('k08', '2026-07-01T20:00:00Z', 'round_of_32'),
    make('k09', '2026-07-01T23:00:00Z', 'round_of_32'),
    make('k10', '2026-07-02T16:00:00Z', 'round_of_32'),
    make('k11', '2026-07-02T20:00:00Z', 'round_of_32'),
    make('k12', '2026-07-02T23:00:00Z', 'round_of_32'),
    make('k13', '2026-07-03T16:00:00Z', 'round_of_32'),
    make('k14', '2026-07-03T20:00:00Z', 'round_of_32'),
    make('k15', '2026-07-03T23:00:00Z', 'round_of_32'),
    make('k16', '2026-07-03T23:00:00Z', 'round_of_32'),

    // Round of 16 (k17-k24): 2026-07-04 → 2026-07-07
    make('k17', '2026-07-04T16:00:00Z', 'round_of_16'),
    make('k18', '2026-07-04T20:00:00Z', 'round_of_16'),
    make('k19', '2026-07-05T16:00:00Z', 'round_of_16'),
    make('k20', '2026-07-05T20:00:00Z', 'round_of_16'),
    make('k21', '2026-07-06T16:00:00Z', 'round_of_16'),
    make('k22', '2026-07-06T20:00:00Z', 'round_of_16'),
    make('k23', '2026-07-07T16:00:00Z', 'round_of_16'),
    make('k24', '2026-07-07T20:00:00Z', 'round_of_16'),

    // Quarter finals (k25-k28): 2026-07-09 → 2026-07-11
    make('k25', '2026-07-09T20:00:00Z', 'quarter_final'),
    make('k26', '2026-07-10T20:00:00Z', 'quarter_final'),
    make('k27', '2026-07-11T16:00:00Z', 'quarter_final'),
    make('k28', '2026-07-11T20:00:00Z', 'quarter_final'),

    // Semi finals (k29-k30): 2026-07-14 → 2026-07-15
    make('k29', '2026-07-14T20:00:00Z', 'semi_final'),
    make('k30', '2026-07-15T20:00:00Z', 'semi_final'),

    // 3rd place playoff (k31): 2026-07-18
    make('k31', '2026-07-18T16:00:00Z', 'third_place'),

    // Final (k32): 2026-07-19
    make('k32', '2026-07-19T19:00:00Z', 'final'),
  ];

  const batch = writeBatch(db);
  matches.forEach((m) => batch.set(doc(db, 'matches', m.id), m));
  await batch.commit();
  return matches.length;
}

// Atnaujinti knockout match'o komandas (admin po grupių etapo pabaigos)
export function setKnockoutTeams(matchId, home, away) {
  return updateDoc(doc(db, 'matches', matchId), {
    home: home || null,
    away: away || null,
  });
}

// === REZULTATŲ SINCHRONIZAVIMAS IŠ FOOTBALL-DATA.ORG API ===
// API teikia oficialius PFČ rezultatus realiu laiku
// Free tier: 10 užklausų/min - pakanka draugų app'ui
// Dokumentacija: https://www.football-data.org/documentation/quickstart

// Komandų pavadinimų žemėlapis - API grąžina anglišką pavadinimą, mes naudojam 3 raidžių kodą
// Kelios alternatyvos vienam kodui dėl skirtingų API atsakymų formatų
const API_NAME_TO_CODE = {
  // Group A
  'Mexico': 'MEX',
  'South Africa': 'RSA',
  'Korea Republic': 'KOR',
  'South Korea': 'KOR',
  'Czechia': 'CZE',
  'Czech Republic': 'CZE',
  // Group B
  'Canada': 'CAN',
  'Switzerland': 'SUI',
  'Qatar': 'QAT',
  'Bosnia-Herzegovina': 'BIH',
  'Bosnia and Herzegovina': 'BIH',
  // Group C
  'Brazil': 'BRA',
  'Morocco': 'MAR',
  'Haiti': 'HAI',
  'Scotland': 'SCO',
  // Group D
  'USA': 'USA',
  'United States': 'USA',
  'Paraguay': 'PAR',
  'Australia': 'AUS',
  'Turkey': 'TUR',
  'Türkiye': 'TUR',
  // Group E
  'Germany': 'GER',
  'Curaçao': 'CUW',
  'Curacao': 'CUW',
  "Côte d'Ivoire": 'CIV',
  'Ivory Coast': 'CIV',
  'Ecuador': 'ECU',
  // Group F
  'Netherlands': 'NED',
  'Japan': 'JPN',
  'Sweden': 'SWE',
  'Tunisia': 'TUN',
  // Group G
  'Belgium': 'BEL',
  'Egypt': 'EGY',
  'Iran': 'IRN',
  'New Zealand': 'NZL',
  // Group H
  'Spain': 'ESP',
  'Cape Verde': 'CPV',
  'Cape Verde Islands': 'CPV',
  'Saudi Arabia': 'KSA',
  'Uruguay': 'URU',
  // Group I
  'France': 'FRA',
  'Senegal': 'SEN',
  'Norway': 'NOR',
  'Iraq': 'IRQ',
  // Group J
  'Argentina': 'ARG',
  'Algeria': 'ALG',
  'Austria': 'AUT',
  'Jordan': 'JOR',
  // Group K
  'Portugal': 'POR',
  'Congo DR': 'COD',
  'DR Congo': 'COD',
  'Democratic Republic of the Congo': 'COD',
  'Uzbekistan': 'UZB',
  'Colombia': 'COL',
  // Group L
  'England': 'ENG',
  'Croatia': 'CRO',
  'Ghana': 'GHA',
  'Panama': 'PAN',
};

// Mūsų vidiniai komandų kodai - jei API TLA tiesiogiai sutampa, naudojame jį.
// Visa kita - per pavadinimo žemėlapį (dengia variantus "South Korea" / "Korea Republic" ir t.t.)
const OUR_TEAM_CODES = new Set([
  'MEX','RSA','KOR','CZE','CAN','SUI','QAT','BIH','BRA','MAR','HAI','SCO',
  'USA','PAR','AUS','TUR','GER','CUW','CIV','ECU','NED','JPN','SWE','TUN',
  'BEL','EGY','IRN','NZL','ESP','CPV','KSA','URU','FRA','SEN','NOR','IRQ',
  'ARG','ALG','AUT','JOR','POR','COD','UZB','COL','ENG','CRO','GHA','PAN',
]);

function findTeamCode(apiTeam) {
  if (!apiTeam) return null;
  // 1) Tiesioginis TLA atitikmuo (BRA, ARG, GER ir t.t. - dauguma atveju sutampa)
  if (apiTeam.tla && OUR_TEAM_CODES.has(apiTeam.tla)) {
    return apiTeam.tla;
  }
  // 2) Per pavadinimo žemėlapį (KOR/RSA/KSA ir kt., kur TLA gali skirtis)
  const name = apiTeam.name?.trim();
  if (name && API_NAME_TO_CODE[name]) {
    return API_NAME_TO_CODE[name];
  }
  return null;
}

// API statusų pavertimas į mūsų vidinius statusus
function mapApiStatus(apiStatus) {
  if (apiStatus === 'FINISHED' || apiStatus === 'AWARDED') return 'finished';
  if (apiStatus === 'IN_PLAY' || apiStatus === 'PAUSED') return 'live';
  return 'upcoming'; // TIMED, SCHEDULED, POSTPONED, CANCELLED, SUSPENDED
}

// API stage → mūsų vidinis stage
const API_STAGE_TO_INTERNAL = {
  'GROUP_STAGE': 'group',
  'LAST_32': 'round_of_32',
  'LAST_16': 'round_of_16',
  'QUARTER_FINALS': 'quarter_final',
  'SEMI_FINALS': 'semi_final',
  'THIRD_PLACE': 'third_place',
  'THIRD_PLACE_FINAL': 'third_place',
  'FINAL': 'final',
};

// Pagrindinė sinchronizavimo funkcija
// Kviečia Netlify Function (tarpininkas), kuri jau turi API raktą serveryje
// Tai sprendžia CORS problemą + raktas paslėptas serveryje
// Reikalauja admin teisių (verifikuoja serveryje per Firebase ID token).
export async function syncResultsFromAPI() {
  // Gauti dabartinio vartotojo ID token'ą - reikalingas Netlify Function autentifikacijai
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Reikia būti prisijungusiam, kad galėtum sinchronizuoti.');
  }
  let idToken;
  try {
    idToken = await user.getIdToken();
  } catch (err) {
    throw new Error('Nepavyko gauti autentifikacijos token\'o: ' + err.message);
  }

  // Užklausa per mūsų Netlify Function su Bearer token
  let response;
  try {
    response = await fetch('/.netlify/functions/sync-results', {
      headers: { Authorization: `Bearer ${idToken}` },
    });
  } catch (err) {
    throw new Error('Nepavyko susisiekti su sinchronizacijos funkcija. Patikrink internetą.');
  }

  // Funkcija grąžina JSON su error lauku jei kažkas nepavyko
  if (!response.ok) {
    let errorData = {};
    try {
      errorData = await response.json();
    } catch (_) {
      // ignore
    }
    throw new Error(errorData.error || `Funkcija grąžino ${response.status}`);
  }

  const data = await response.json();
  const apiMatches = data.matches || [];

  if (apiMatches.length === 0) {
    return { total: 0, matched: 0, updated: 0, skipped: 0, unmatched: [] };
  }

  // Gauti visus mūsų matches
  const snapshot = await getDocs(collection(db, 'matches'));
  const ourMatches = [];
  snapshot.forEach((d) => ourMatches.push({ id: d.id, ...d.data() }));

  const stats = {
    total: apiMatches.length,
    matched: 0,
    updated: 0,
    created: 0,
    skipped: 0,
    unmatched: [],
  };

  const batch = writeBatch(db);

  // Set'as, į kurį dedame jau "paimtus" placeholder ID'us per šitą sync iteraciją,
  // kad du API match'ai su tuo pačiu kickoff laiku negautų to paties k slot'o
  const claimedPlaceholderIds = new Set();

  for (const apiMatch of apiMatches) {
    const homeCode = findTeamCode(apiMatch.homeTeam);
    const awayCode = findTeamCode(apiMatch.awayTeam);

    // Neradome komandų kodų - dažniausiai knockout match'as su null komandomis (TBD)
    if (!homeCode || !awayCode) {
      stats.unmatched.push(`${apiMatch.homeTeam?.name || '?'} vs ${apiMatch.awayTeam?.name || '?'}`);
      continue;
    }

    // 1) Pirmas bandymas: rasti mūsų match pagal tikslias komandas + kickoff ±24h.
    // Tai veikia kai komandos jau priskirtos (grupių etapas arba pakartotinis sync).
    const apiTime = new Date(apiMatch.utcDate).getTime();
    let ourMatch = ourMatches.find((m) => {
      if (m.home !== homeCode || m.away !== awayCode) return false;
      const ourTime = new Date(m.kickoff).getTime();
      return Math.abs(apiTime - ourTime) < 24 * 3600000;
    });

    // Sekti ar tai placeholder, kurį dabar užpildome komandomis - tada UPDATE turi pridėti home/away
    let fillingPlaceholder = false;

    // 2) Antras bandymas (tik knockout): rasti TUŠČIĄ placeholder k01-k32 su tuo pačiu
    // stage ir kickoff ±24h. Tai užkerta dublikatų atsiradimą per pirmą knockout sync.
    if (!ourMatch) {
      const internalStage = API_STAGE_TO_INTERNAL[apiMatch.stage];
      if (internalStage && internalStage !== 'group') {
        ourMatch = ourMatches.find((m) => {
          if (m.stage !== internalStage) return false;
          if (m.home !== null || m.away !== null) return false; // jau užpildytas
          if (claimedPlaceholderIds.has(m.id)) return false; // jau paimtas šitoje iteracijoje
          const ourTime = new Date(m.kickoff).getTime();
          return Math.abs(apiTime - ourTime) < 24 * 3600000;
        });
        if (ourMatch) {
          claimedPlaceholderIds.add(ourMatch.id);
          fillingPlaceholder = true;
        }
      }
    }

    // 3) Jei niekas neradom - kaip atsarginis variantas sukurti naują wcXXXX (knockout)
    // arba pranešti apie nepriderintą (grupių etapas - admin'as neseedino)
    if (!ourMatch) {
      const internalStage = API_STAGE_TO_INTERNAL[apiMatch.stage];

      if (internalStage && internalStage !== 'group') {
        const newId = `wc${apiMatch.id}`;
        const newStatus = mapApiStatus(apiMatch.status);

        let newScore = null;
        const ftHome = apiMatch.score?.fullTime?.home;
        const ftAway = apiMatch.score?.fullTime?.away;
        if ((newStatus === 'finished' || newStatus === 'live') && ftHome != null && ftAway != null) {
          newScore = { home: ftHome, away: ftAway };
        }

        const newMatch = {
          id: newId,
          home: homeCode,
          away: awayCode,
          kickoff: apiMatch.utcDate,
          stage: internalStage,
          group: null, // knockout match'ai neturi grupės
          status: newStatus,
          actualScore: newScore,
        };

        const ref = doc(db, 'matches', newId);
        batch.set(ref, newMatch);
        stats.created++;
        continue;
      }

      // Grupių etapo match'as kurio nėra DB - turbūt admin'as neseedino g01-g72
      stats.unmatched.push(`${apiMatch.homeTeam?.name} vs ${apiMatch.awayTeam?.name} (nerasta mūsų DB)`);
      continue;
    }

    stats.matched++;

    // Naujas statusas iš API
    const newStatus = mapApiStatus(apiMatch.status);

    // Naujas rezultatas
    let newScore = null;
    const ftHome = apiMatch.score?.fullTime?.home;
    const ftAway = apiMatch.score?.fullTime?.away;
    const htHome = apiMatch.score?.halfTime?.home;
    const htAway = apiMatch.score?.halfTime?.away;

    if ((newStatus === 'finished' || newStatus === 'live')) {
      if (ftHome != null && ftAway != null) {
        newScore = { home: ftHome, away: ftAway };
      } else if (htHome != null && htAway != null) {
        // Live match, only halftime data available
        newScore = { home: htHome, away: htAway };
      }
    }

    // Jei pildomas placeholder - VISADA reikia update'inti (bent komandos pasikeitė)
    if (fillingPlaceholder) {
      const ref = doc(db, 'matches', ourMatch.id);
      batch.update(ref, {
        home: homeCode,
        away: awayCode,
        status: newStatus,
        actualScore: newScore,
      });
      stats.updated++;
      continue;
    }

    // Įprastinis update - ar reikia kažką keisti?
    const statusChanged = newStatus !== ourMatch.status;
    const scoreChanged = JSON.stringify(newScore) !== JSON.stringify(ourMatch.actualScore);

    if (statusChanged || scoreChanged) {
      const ref = doc(db, 'matches', ourMatch.id);
      batch.update(ref, {
        status: newStatus,
        actualScore: newScore,
      });
      stats.updated++;
    } else {
      stats.skipped++;
    }
  }

  if (stats.updated > 0 || stats.created > 0) {
    await batch.commit();
  }

  return stats;
}
