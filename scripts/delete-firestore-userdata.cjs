/**
 * delete-firestore-userdata.cjs — VIENKARTINIS projekto uždarymo įrankis.
 *
 * Ištrina TIK asmens duomenų kolekcijas. Programos duomenys lieka nepaliesti.
 *
 * TRINAMA:  users, users_private, usernames, predictions, tournamentBets, audit_log
 * PALIEKAMA: matches, tournamentResults, companies, system
 *
 * Saugos principas: trinamų kolekcijų sąrašas čia yra ŽALAI ĮRAŠYTAS (hardcoded).
 * Skriptas fiziškai negali paliesti jokios kitos kolekcijos.
 *
 * SAUGU PAGAL NUTYLĖJIMĄ: be `--confirm` tik SUSKAIČIUOJA, nieko netrina.
 *
 * Paleidimas (Google Cloud Shell, po `npm install firebase-admin`):
 *   Sausas bandymas:  node scripts/delete-firestore-userdata.cjs --project pfc-2026-totalizatorius
 *   Realus trynimas:  node scripts/delete-firestore-userdata.cjs --project pfc-2026-totalizatorius --confirm
 */

const admin = require('firebase-admin');

const DELETE_COLLECTIONS = ['users', 'users_private', 'usernames', 'predictions', 'tournamentBets', 'audit_log'];
const KEEP_COLLECTIONS = ['matches', 'tournamentResults', 'companies', 'system'];

const args = process.argv.slice(2);
const getArg = (name) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=')[1];
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return null;
};

const projectId = getArg('project') || process.env.GCLOUD_PROJECT || process.env.VITE_FIREBASE_PROJECT_ID;
const confirm = args.includes('--confirm');

if (!projectId) {
  console.error('KLAIDA: nurodyk projektą:  --project TAVO_PROJECT_ID');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId,
});
const db = admin.firestore();

async function main() {
  console.log(`\nProjektas: ${projectId}`);
  console.log(`Režimas:   ${confirm ? 'REALUS TRYNIMAS' : 'SAUSAS BANDYMAS (nieko netrinama)'}`);
  console.log(`Paliekama nepaliesta: ${KEEP_COLLECTIONS.join(', ')}\n`);

  // 1) Suskaičiuoti, kiek įrašų kiekvienoje trinamoje kolekcijoje.
  const counts = {};
  let totalDocs = 0;
  for (const name of DELETE_COLLECTIONS) {
    const snap = await db.collection(name).count().get();
    const n = snap.data().count;
    counts[name] = n;
    totalDocs += n;
    console.log(`  ${name.padEnd(16)} ${n} įrašų`);
  }
  console.log(`  ${''.padEnd(16)} —————`);
  console.log(`  ${'IŠ VISO'.padEnd(16)} ${totalDocs} įrašų\n`);

  if (totalDocs === 0) {
    console.log('Nėra ką trinti. Baigta.');
    return;
  }

  if (!confirm) {
    console.log('Tai buvo tik sausas bandymas — niekas neištrinta.');
    console.log('Kai skaičiai atrodo teisingi, paleisk tą pačią komandą su  --confirm');
    return;
  }

  // 2) Realus trynimas — recursiveDelete kiekvienai kolekcijai atskirai.
  console.log('Trinama...');
  for (const name of DELETE_COLLECTIONS) {
    if (counts[name] === 0) {
      console.log(`  ${name}: jau tuščia, praleista`);
      continue;
    }
    await db.recursiveDelete(db.collection(name));
    console.log(`  ${name}: ištrinta (${counts[name]} įrašų)`);
  }

  console.log('\nBAIGTA. Asmens duomenų kolekcijos pašalintos.');
  console.log(`Programos duomenys palikti: ${KEEP_COLLECTIONS.join(', ')}.`);
}

main().catch((err) => {
  console.error('\nKLAIDA:', err.message);
  process.exit(1);
});
