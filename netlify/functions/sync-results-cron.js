// Netlify Scheduled Function - automatiškai sinchronizuoja PFČ 2026 rezultatus iš football-data.org
// Paleidžiama kas 15 minučių (cron: */15 * * * *), apibrėžta netlify.toml [[functions]] sekcijoje.
//
// Skiriasi nuo sync-results.js: tas yra proxy, kurį kviečia admin'as iš naršyklės.
// Šis veikia AUTOMATIŠKAI, nereikalauja vartotojo. Rašo į Firestore per Admin SDK,
// kuris apeina Security Rules (service account turi pilną prieigą).
//
// REIKALINGI ENV VARS (Netlify pusėje):
//   VITE_FOOTBALL_DATA_API_KEY
//   VITE_FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL       (iš service account JSON)
//   FIREBASE_PRIVATE_KEY        (iš service account JSON, su \n išlaikomais)

const { schedule } = require('@netlify/functions');
const admin = require('firebase-admin');

// ============================================================
// FIREBASE ADMIN INIT (idempotent - cold start initializuoja, šiltus tik gauna)
// ============================================================
function initFirebase() {
  if (admin.apps.length > 0) return admin.firestore();

  const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Service account env vars trūksta (VITE_FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)');
  }
  // Netlify env vars eskeipina \n - reikia atstatyti
  privateKey = privateKey.replace(/\\n/g, '\n');

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
  return admin.firestore();
}

// ============================================================
// KOMANDŲ PAVADINIMŲ ŽEMĖLAPIS (sync su src/firebase.js)
// ============================================================
const API_NAME_TO_CODE = {
  'Mexico': 'MEX', 'South Africa': 'RSA', 'Korea Republic': 'KOR', 'South Korea': 'KOR',
  'Czechia': 'CZE', 'Czech Republic': 'CZE',
  'Canada': 'CAN', 'Switzerland': 'SUI', 'Qatar': 'QAT',
  'Bosnia-Herzegovina': 'BIH', 'Bosnia and Herzegovina': 'BIH',
  'Brazil': 'BRA', 'Morocco': 'MAR', 'Haiti': 'HAI', 'Scotland': 'SCO',
  'USA': 'USA', 'United States': 'USA', 'Paraguay': 'PAR', 'Australia': 'AUS',
  'Turkey': 'TUR', 'Türkiye': 'TUR',
  'Germany': 'GER', 'Curaçao': 'CUW', 'Curacao': 'CUW',
  "Côte d'Ivoire": 'CIV', 'Ivory Coast': 'CIV', 'Ecuador': 'ECU',
  'Netherlands': 'NED', 'Japan': 'JPN', 'Sweden': 'SWE', 'Tunisia': 'TUN',
  'Belgium': 'BEL', 'Egypt': 'EGY', 'Iran': 'IRN', 'New Zealand': 'NZL',
  'Spain': 'ESP', 'Cape Verde': 'CPV', 'Cape Verde Islands': 'CPV',
  'Saudi Arabia': 'KSA', 'Uruguay': 'URU',
  'France': 'FRA', 'Senegal': 'SEN', 'Norway': 'NOR', 'Iraq': 'IRQ',
  'Argentina': 'ARG', 'Algeria': 'ALG', 'Austria': 'AUT', 'Jordan': 'JOR',
  'Portugal': 'POR', 'Congo DR': 'COD', 'DR Congo': 'COD',
  'Democratic Republic of the Congo': 'COD', 'Uzbekistan': 'UZB', 'Colombia': 'COL',
  'England': 'ENG', 'Croatia': 'CRO', 'Ghana': 'GHA', 'Panama': 'PAN',
};

const OUR_TEAM_CODES = new Set([
  'MEX','RSA','KOR','CZE','CAN','SUI','QAT','BIH','BRA','MAR','HAI','SCO',
  'USA','PAR','AUS','TUR','GER','CUW','CIV','ECU','NED','JPN','SWE','TUN',
  'BEL','EGY','IRN','NZL','ESP','CPV','KSA','URU','FRA','SEN','NOR','IRQ',
  'ARG','ALG','AUT','JOR','POR','COD','UZB','COL','ENG','CRO','GHA','PAN',
]);

function findTeamCode(apiTeam) {
  if (!apiTeam) return null;
  if (apiTeam.tla && OUR_TEAM_CODES.has(apiTeam.tla)) return apiTeam.tla;
  const name = apiTeam.name && apiTeam.name.trim();
  if (name && API_NAME_TO_CODE[name]) return API_NAME_TO_CODE[name];
  return null;
}

function mapApiStatus(apiStatus) {
  if (apiStatus === 'FINISHED' || apiStatus === 'AWARDED') return 'finished';
  if (apiStatus === 'IN_PLAY' || apiStatus === 'PAUSED') return 'live';
  return 'upcoming';
}

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

// ============================================================
// PAGRINDINĖ SYNC LOGIKA (atkartoja syncResultsFromAPI iš src/firebase.js)
// ============================================================
async function syncCore(db) {
  const apiKey = process.env.VITE_FOOTBALL_DATA_API_KEY || process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) throw new Error('VITE_FOOTBALL_DATA_API_KEY nesukonfigūruotas');

  // 1) Gauti rungtynes iš API
  const apiRes = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
    headers: { 'X-Auth-Token': apiKey },
  });
  if (!apiRes.ok) throw new Error(`football-data.org grąžino ${apiRes.status}`);
  const apiData = await apiRes.json();
  const apiMatches = apiData.matches || [];

  if (apiMatches.length === 0) {
    return { total: 0, matched: 0, updated: 0, created: 0, skipped: 0, unmatched: [] };
  }

  // 2) Gauti mūsų matches iš Firestore
  const matchesSnap = await db.collection('matches').get();
  const ourMatches = [];
  matchesSnap.forEach((d) => ourMatches.push({ id: d.id, ...d.data() }));

  const stats = { total: apiMatches.length, matched: 0, updated: 0, created: 0, skipped: 0, unmatched: [] };
  const batch = db.batch();
  const claimedPlaceholderIds = new Set();

  for (const apiMatch of apiMatches) {
    const homeCode = findTeamCode(apiMatch.homeTeam);
    const awayCode = findTeamCode(apiMatch.awayTeam);
    if (!homeCode || !awayCode) {
      stats.unmatched.push(`${apiMatch.homeTeam?.name || '?'} vs ${apiMatch.awayTeam?.name || '?'}`);
      continue;
    }

    const apiTime = new Date(apiMatch.utcDate).getTime();
    let ourMatch = ourMatches.find((m) => {
      if (m.home !== homeCode || m.away !== awayCode) return false;
      const ourTime = new Date(m.kickoff).getTime();
      return Math.abs(apiTime - ourTime) < 24 * 3600000;
    });

    let fillingPlaceholder = false;

    if (!ourMatch) {
      const internalStage = API_STAGE_TO_INTERNAL[apiMatch.stage];
      if (internalStage && internalStage !== 'group') {
        ourMatch = ourMatches.find((m) => {
          if (m.stage !== internalStage) return false;
          if (m.home !== null || m.away !== null) return false;
          if (claimedPlaceholderIds.has(m.id)) return false;
          const ourTime = new Date(m.kickoff).getTime();
          return Math.abs(apiTime - ourTime) < 24 * 3600000;
        });
        if (ourMatch) {
          claimedPlaceholderIds.add(ourMatch.id);
          fillingPlaceholder = true;
        }
      }
    }

    if (!ourMatch) {
      const internalStage = API_STAGE_TO_INTERNAL[apiMatch.stage];
      if (internalStage && internalStage !== 'group') {
        const newId = `wc${apiMatch.id}`;
        const newStatus = mapApiStatus(apiMatch.status);
        const ftHome = apiMatch.score?.fullTime?.home;
        const ftAway = apiMatch.score?.fullTime?.away;
        let newScore = null;
        if ((newStatus === 'finished' || newStatus === 'live') && ftHome != null && ftAway != null) {
          newScore = { home: ftHome, away: ftAway };
        }
        const newMatch = {
          id: newId,
          home: homeCode,
          away: awayCode,
          kickoff: apiMatch.utcDate,
          kickoffMs: new Date(apiMatch.utcDate).getTime(),
          stage: internalStage,
          group: null,
          status: newStatus,
          actualScore: newScore,
        };
        batch.set(db.collection('matches').doc(newId), newMatch);
        stats.created++;
        continue;
      }
      stats.unmatched.push(`${apiMatch.homeTeam?.name} vs ${apiMatch.awayTeam?.name}`);
      continue;
    }

    stats.matched++;
    const newStatus = mapApiStatus(apiMatch.status);
    let newScore = null;
    const ftHome = apiMatch.score?.fullTime?.home;
    const ftAway = apiMatch.score?.fullTime?.away;
    const htHome = apiMatch.score?.halfTime?.home;
    const htAway = apiMatch.score?.halfTime?.away;
    if (newStatus === 'finished' || newStatus === 'live') {
      if (ftHome != null && ftAway != null) newScore = { home: ftHome, away: ftAway };
      else if (htHome != null && htAway != null) newScore = { home: htHome, away: htAway };
    }

    const apiKickoffMs = new Date(apiMatch.utcDate).getTime();
    const needsKickoffMs = ourMatch.kickoffMs == null || ourMatch.kickoffMs !== apiKickoffMs;

    if (fillingPlaceholder) {
      batch.update(db.collection('matches').doc(ourMatch.id), {
        home: homeCode,
        away: awayCode,
        kickoff: apiMatch.utcDate,
        kickoffMs: apiKickoffMs,
        status: newStatus,
        actualScore: newScore,
      });
      stats.updated++;
      continue;
    }

    const statusChanged = newStatus !== ourMatch.status;
    const scoreChanged = JSON.stringify(newScore) !== JSON.stringify(ourMatch.actualScore);

    if (statusChanged || scoreChanged || needsKickoffMs) {
      const updateData = { status: newStatus, actualScore: newScore };
      if (needsKickoffMs) {
        updateData.kickoffMs = apiKickoffMs;
        updateData.kickoff = apiMatch.utcDate;
      }
      batch.update(db.collection('matches').doc(ourMatch.id), updateData);
      stats.updated++;
    } else {
      stats.skipped++;
    }
  }

  if (stats.updated > 0 || stats.created > 0) {
    await batch.commit();
  }

  // Audit log
  try {
    await db.collection('audit_log').add({
      actorUid: 'system-cron',
      action: 'autoSyncResults',
      targetId: null,
      details: { matched: stats.matched, updated: stats.updated, created: stats.created, skipped: stats.skipped },
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('audit_log write failed:', e.message);
  }

  return stats;
}

// ============================================================
// HANDLER + SCHEDULE
// ============================================================
const handler = async () => {
  try {
    const db = initFirebase();
    const stats = await syncCore(db);
    console.log('[cron sync] OK:', JSON.stringify(stats));
    return { statusCode: 200, body: JSON.stringify(stats) };
  } catch (err) {
    console.error('[cron sync] ERROR:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// Cron: kas 15 minučių
exports.handler = schedule('*/15 * * * *', handler);
