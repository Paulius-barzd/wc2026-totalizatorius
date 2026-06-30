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

// Statusų prioritetai - aukštesnis = vėlesnė turnyro fazė.
// Naudojama tam, kad cron'as NIEKADA negrąžintų status atgal (pvz. live -> upcoming)
// nes API gali turėti vėlavimą ir reportuoti TIMED net jau prasidėjusiai rungtynei.
const STATUS_RANK = { upcoming: 0, live: 1, finished: 2 };
function shouldUpgradeStatus(current, incoming) {
  return (STATUS_RANK[incoming] || 0) > (STATUS_RANK[current] || 0);
}

// Grąžina rezultatą TIK pagal pagrindinį laiką (90 min + injury), be pratęsimo ir baudinių.
// Reikalinga atkrintamosioms - Taisyklėse vertinamas tik 90 min rezultatas.
// football-data.org duomenų struktūra:
//   score.fullTime - PATEIKIA aggregated (regulation + ET + penalties) kai duration != REGULAR
//   score.regularTime - jei egzistuoja, tai švarus 90 min rezultatas
//   score.penalties - baudinių serijos rezultatas atskirai
//   score.duration: REGULAR | EXTRA_TIME | PENALTY_SHOOTOUT
function getRegulationScore(score) {
  if (!score) return null;
  // Pirmiausia bandyti regularTime (švariausias laukas)
  if (score.regularTime && score.regularTime.home != null && score.regularTime.away != null) {
    return { home: score.regularTime.home, away: score.regularTime.away };
  }
  const ft = score.fullTime;
  if (!ft || ft.home == null || ft.away == null) return null;
  // Jei rungtynė ėjo iki baudinių IR fullTime atrodo kaip suma (regulation + penalties),
  // atimam baudinius. Atimimas saugomas tik jei rezultatas yra galiojantis lygiosios
  // (baudiniai vyksta tik po lygiųjų), kitu atveju fullTime jau yra 90 min rezultatas.
  if (score.duration === 'PENALTY_SHOOTOUT' && score.penalties &&
      score.penalties.home != null && score.penalties.away != null) {
    const h = ft.home - score.penalties.home;
    const a = ft.away - score.penalties.away;
    if (h >= 0 && a >= 0 && h === a) {
      return { home: h, away: a };
    }
  }
  return { home: ft.home, away: ft.away };
}

// Surenkam galutinį atkrintamųjų rezultatą atskirai nuo regulation (90 min).
// Naudojama UI'e rodyti mažu šriftu „Po baudinių: 2:3" arba „Po pratęsimo".
// Grąžina null jei rungtynė baigėsi reguliaraus laiko metu.
function getMatchOutcome(score) {
  if (!score || !score.duration || score.duration === 'REGULAR') return null;
  const outcome = { type: score.duration };
  if (score.penalties && score.penalties.home != null && score.penalties.away != null) {
    outcome.penalties = { home: score.penalties.home, away: score.penalties.away };
  }
  if (score.extraTime && score.extraTime.home != null && score.extraTime.away != null) {
    outcome.extraTime = { home: score.extraTime.home, away: score.extraTime.away };
  }
  return outcome;
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
// PREDICTIONS REVEAL — žymi predictions kaip viešai matomas leaderboard'e
// ============================================================
// Firestore Rules query'iams reikalauja statiškai patenkinamos sąlygos.
// Klientas daro `where('revealed', '==', true)`, rule branch 3 patikrina tą patį
// per-doc. Be šio lauko ne-admin'ai gauna permission-denied visam query'iui.
const FIRESTORE_BATCH_LIMIT = 500;

async function revealPredictionsForMatches(db, matchIds) {
  if (!matchIds || matchIds.length === 0) return 0;
  let totalRevealed = 0;
  for (const matchId of matchIds) {
    const predsSnap = await db.collection('predictions').where('matchId', '==', matchId).get();
    const docs = predsSnap.docs.filter((d) => d.data().revealed !== true);
    for (let i = 0; i < docs.length; i += FIRESTORE_BATCH_LIMIT) {
      const chunk = docs.slice(i, i + FIRESTORE_BATCH_LIMIT);
      const batch = db.batch();
      chunk.forEach((d) => batch.update(d.ref, { revealed: true }));
      await batch.commit();
      totalRevealed += chunk.length;
    }
  }
  return totalRevealed;
}

// Self-healing backfill — pirmą kartą po deploy'o nuskaitom visas non-upcoming
// rungtynes ir reveal'iname jų predictions. Po sėkmingo backfill'o pažymime
// system/backfillStatus, kad sekančios cron iteracijos praleistų šį žingsnį.
async function maybeRunBackfill(db, stats) {
  const ref = db.collection('system').doc('backfillStatus');
  const snap = await ref.get();
  if (snap.exists && snap.data().revealedBackfillAt) {
    return; // backfill jau atliktas
  }

  const matchesSnap = await db.collection('matches').where('status', 'in', ['live', 'finished']).get();
  const matchIds = matchesSnap.docs.map((d) => d.id);
  const revealed = await revealPredictionsForMatches(db, matchIds);
  stats.backfillRevealed = revealed;
  stats.backfilledMatches = matchIds.length;

  await ref.set({
    revealedBackfillAt: admin.firestore.FieldValue.serverTimestamp(),
    matchesProcessed: matchIds.length,
    predictionsRevealed: revealed,
  }, { merge: true });

  try {
    await db.collection('audit_log').add({
      actorUid: 'system-cron',
      action: 'revealedBackfill',
      targetId: null,
      details: { matchesProcessed: matchIds.length, predictionsRevealed: revealed },
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('audit_log write failed (backfill):', e.message);
  }
}

// ============================================================
// CONSOLIDATION: surasti wcXXXX dublikatus tuščiems kXX placeholder'iams
// ============================================================
// Cron'as kartais sukurdavo wcXXXX rungtynę, kai pirmąjį kartą pamatė knockout match'ą
// API'jaus pusėje su kickoff, kuris nesutapo (±24h) su esamais tuščiais kXX. Dabar
// (po smarter matching diegimo) tas neturėtų pasikartoti, bet jei jau yra anksčiau
// sukurtų wcXXXX dublikatų — sutvarkome juos automatiškai:
//   1) Surandam wcXXXX su užpildytomis komandomis
//   2) Patikrinam ar yra tuščias kXX tame pačiame etape (jei yra - tai dublikatas)
//   3) Perkeliam wcXXXX duomenis į kXX
//   4) Migruojam visus predictions (matchId pakeičia iš wcXXXX į kXX)
//   5) Ištriname wcXXXX
async function consolidateKnockoutDuplicates(db, stats) {
  const matchesSnap = await db.collection('matches').get();
  const all = [];
  matchesSnap.forEach((d) => all.push({ id: d.id, ...d.data() }));

  const wcMatches = all.filter((m) =>
    m.id && m.id.startsWith('wc') && m.home && m.away && m.stage && m.stage !== 'group'
  );
  if (wcMatches.length === 0) return;

  let consolidated = 0;
  let predsMigrated = 0;
  const claimedKx = new Set();

  for (const wcMatch of wcMatches) {
    // Rasti tuščią kXX placeholder'į tame etape (kuris dar nepasiimtas šitoj iteracijoj)
    const emptyKx = all.find((m) =>
      m.id && m.id.startsWith('k') &&
      m.stage === wcMatch.stage &&
      m.home === null && m.away === null &&
      !claimedKx.has(m.id)
    );
    if (!emptyKx) continue;
    claimedKx.add(emptyKx.id);

    // 1) Atnaujinti kXX su wcMatch duomenimis
    const updateData = {
      home: wcMatch.home,
      away: wcMatch.away,
      kickoff: wcMatch.kickoff,
      kickoffMs: wcMatch.kickoffMs,
      status: wcMatch.status,
      actualScore: wcMatch.actualScore || null,
    };
    if (wcMatch.outcome !== undefined) updateData.outcome = wcMatch.outcome;
    if (wcMatch.revealed !== undefined) updateData.revealed = wcMatch.revealed;
    await db.collection('matches').doc(emptyKx.id).update(updateData);

    // 2) Migruoti predictions: matchId wcXXXX -> kXX
    const predsSnap = await db.collection('predictions')
      .where('matchId', '==', wcMatch.id).get();
    if (!predsSnap.empty) {
      const predBatch = db.batch();
      predsSnap.forEach((p) => predBatch.update(p.ref, { matchId: emptyKx.id }));
      await predBatch.commit();
      predsMigrated += predsSnap.size;
    }

    // 3) Ištrinti wcMatch
    await db.collection('matches').doc(wcMatch.id).delete();
    consolidated++;

    // Atnaujinti lokalų `all` masyvą - kad sekantis wcMatch tame pačiame iteration'e
    // matytų jau užpildytą kXX (kad neimtų to paties)
    const idx = all.findIndex((m) => m.id === emptyKx.id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], home: wcMatch.home, away: wcMatch.away };
    }
  }

  stats.consolidated = consolidated;
  stats.predsConsolidated = predsMigrated;

  if (consolidated > 0) {
    try {
      await db.collection('audit_log').add({
        actorUid: 'system-cron',
        action: 'consolidateKnockoutDuplicates',
        targetId: null,
        details: { consolidated, predsMigrated },
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      console.warn('audit_log write failed (consolidate):', e.message);
    }
  }
}

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

  const stats = { total: apiMatches.length, matched: 0, updated: 0, created: 0, skipped: 0, unmatched: [], revealed: 0, consolidated: 0, predsConsolidated: 0 };

  // 1.5) Pirma sutvarkyti esamus wcXXXX dublikatus tuštiems kXX placeholder'iams.
  // Idempotent: jei nieko nėra, nieko nedaro. Vykdoma PRIEŠ matches load'ą, kad
  // toliau eitume su jau sutvarkyta būsena.
  await consolidateKnockoutDuplicates(db, stats);

  // 2) Gauti mūsų matches iš Firestore (po consolidation, kad būtų aktuali būsena)
  const matchesSnap = await db.collection('matches').get();
  const ourMatches = [];
  matchesSnap.forEach((d) => ourMatches.push({ id: d.id, ...d.data() }));
  const batch = db.batch();
  const claimedPlaceholderIds = new Set();
  // Match'ai, kurių predictions reikia reveal'inti (perėjimas iš upcoming → live/finished).
  // Po pagrindinio batch commit'o atlieksim per-match predictions update batch'ais.
  const matchesToReveal = new Set();

  for (const apiMatch of apiMatches) {
    const homeCode = findTeamCode(apiMatch.homeTeam);
    const awayCode = findTeamCode(apiMatch.awayTeam);
    if (!homeCode || !awayCode) {
      stats.unmatched.push(`${apiMatch.homeTeam?.name || '?'} vs ${apiMatch.awayTeam?.name || '?'}`);
      continue;
    }

    const apiTime = new Date(apiMatch.utcDate).getTime();
    // 1) Pirmas bandymas - rasti pagal tikslias komandas, ignoruojant kickoff laiką
    // (FIFA gali pakeisti tvarkaraščius - svarbiausia komandų atitikimas)
    let ourMatch = ourMatches.find((m) =>
      m.home === homeCode && m.away === awayCode
    );

    let fillingPlaceholder = false;

    if (!ourMatch) {
      const internalStage = API_STAGE_TO_INTERNAL[apiMatch.stage];
      if (internalStage && internalStage !== 'group') {
        // 2) Antras bandymas - rasti tuščią placeholder'į TAME ETAPE.
        // Praplėstas ±7 dienų langas, kad būtų atsparu schedule pakeitimams.
        // Prioritetas: kuo arčiau API laiko, tas placeholder'is.
        const candidates = ourMatches
          .filter((m) =>
            m.stage === internalStage &&
            m.home === null && m.away === null &&
            !claimedPlaceholderIds.has(m.id) &&
            m.id.startsWith('k') &&
            Math.abs(apiTime - new Date(m.kickoff).getTime()) < 7 * 24 * 3600000
          )
          .sort((a, b) =>
            Math.abs(apiTime - new Date(a.kickoff).getTime()) -
            Math.abs(apiTime - new Date(b.kickoff).getTime())
          );
        ourMatch = candidates[0];
        // Jei joks pagal laiką nepasitvirtino - imame BET KOKĮ tuščią placeholder'į tame etape
        if (!ourMatch) {
          ourMatch = ourMatches.find((m) =>
            m.stage === internalStage &&
            m.home === null && m.away === null &&
            !claimedPlaceholderIds.has(m.id) &&
            m.id.startsWith('k')
          );
        }
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
        let newScore = null;
        if (newStatus === 'finished' || newStatus === 'live') {
          newScore = getRegulationScore(apiMatch.score);
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
          outcome: getMatchOutcome(apiMatch.score),
        };
        batch.set(db.collection('matches').doc(newId), newMatch);
        stats.created++;
        continue;
      }
      stats.unmatched.push(`${apiMatch.homeTeam?.name} vs ${apiMatch.awayTeam?.name}`);
      continue;
    }

    stats.matched++;
    const apiStatusMapped = mapApiStatus(apiMatch.status);
    let apiScore = null;
    if (apiStatusMapped === 'finished' || apiStatusMapped === 'live') {
      apiScore = getRegulationScore(apiMatch.score);
      // Fallback į halftime jei nieko kito nėra
      if (!apiScore) {
        const htHome = apiMatch.score?.halfTime?.home;
        const htAway = apiMatch.score?.halfTime?.away;
        if (htHome != null && htAway != null) apiScore = { home: htHome, away: htAway };
      }
    }

    const apiKickoffMs = new Date(apiMatch.utcDate).getTime();
    const needsKickoffMs = ourMatch.kickoffMs == null || ourMatch.kickoffMs !== apiKickoffMs;

    if (fillingPlaceholder) {
      // Naujai pildomas placeholder - imti pilnai iš API (mūsų pusėje dar nieko nėra)
      batch.update(db.collection('matches').doc(ourMatch.id), {
        home: homeCode,
        away: awayCode,
        kickoff: apiMatch.utcDate,
        kickoffMs: apiKickoffMs,
        status: apiStatusMapped,
        actualScore: apiScore,
        outcome: getMatchOutcome(apiMatch.score),
      });
      // Jei placeholder pildomas jau ne-upcoming statusu, reikia reveal'inti
      // (mažai tikėtina, kad bus predictions, bet saugu)
      if (apiStatusMapped !== 'upcoming') {
        matchesToReveal.add(ourMatch.id);
      }
      stats.updated++;
      continue;
    }

    // === MONOTONIŠKAS STATUS UPGRADE - apsauga nuo API vėlavimo ===
    // Cron'as NIEKADA negrąžina status atgal (live -> upcoming, finished -> live ir t.t.).
    // Jei API atneša "senesnį" statusą, paliekam mūsų esamą reikšmę.
    // Tai išsprendžia atvejį, kai admin'as rankomis pažymėjo 'live' bet API dar rodo 'TIMED'.
    const finalStatus = shouldUpgradeStatus(ourMatch.status, apiStatusMapped)
      ? apiStatusMapped
      : ourMatch.status;

    // Score'o atnaujinimas tik kai status persijungia į live/finished IR API atneša rezultatą.
    // Jei API neturi rezultato (null), bet mes turime - neperrašom į null.
    let finalScore = ourMatch.actualScore;
    if ((finalStatus === 'live' || finalStatus === 'finished') && apiScore != null) {
      finalScore = apiScore;
    }

    const statusChanged = finalStatus !== ourMatch.status;
    const scoreChanged = JSON.stringify(finalScore) !== JSON.stringify(ourMatch.actualScore);
    const apiOutcome = getMatchOutcome(apiMatch.score);
    const outcomeChanged = JSON.stringify(apiOutcome) !== JSON.stringify(ourMatch.outcome || null);

    if (statusChanged || scoreChanged || needsKickoffMs || outcomeChanged) {
      const updateData = {};
      if (statusChanged) updateData.status = finalStatus;
      if (scoreChanged) updateData.actualScore = finalScore;
      if (outcomeChanged) updateData.outcome = apiOutcome;
      if (needsKickoffMs) {
        updateData.kickoffMs = apiKickoffMs;
        updateData.kickoff = apiMatch.utcDate;
      }
      batch.update(db.collection('matches').doc(ourMatch.id), updateData);
      stats.updated++;
      // Jei statusas perėjo iš 'upcoming' į ką nors kitą — reveal'iname predictions.
      // Tai būtina, kad ne-admin'ai matytų leaderboard'ą (rule branch 3:
      // resource.data.revealed == true).
      if (statusChanged && ourMatch.status === 'upcoming' && finalStatus !== 'upcoming') {
        matchesToReveal.add(ourMatch.id);
      }
    } else {
      stats.skipped++;
    }
  }

  if (stats.updated > 0 || stats.created > 0) {
    await batch.commit();
  }

  // === REVEAL PREDICTIONS ===
  // Po pagrindinio batch'o atlieksim predictions reveal'us. Daromas atskirai, nes:
  // 1) Reikia query'inti predictions kolekciją (negali būti tame pačiame batch'e kaip writes)
  // 2) Predictions kiekis gali viršyti 500 doc/batch limitą — chunkinam
  stats.revealed = await revealPredictionsForMatches(db, Array.from(matchesToReveal));

  // === SELF-HEALING BACKFILL ===
  // Pirmąjį kartą po deploy'o (kai system/backfillStatus dar neegzistuoja),
  // padarom pilną pasibaigusių/vyksta rungtynių predictions reveal'ą.
  // Idempotent — kitos cron iteracijos praleidžia.
  await maybeRunBackfill(db, stats);

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
