/**
 * delete-auth-users.cjs — VIENKARTINIS projekto uždarymo įrankis.
 *
 * Ištrina VISAS Firebase Authentication paskyras (el. paštai + slaptažodžių maišos).
 * Tai ATSKIRA nuo Firestore — Firestore kolekcijų trynimas šių paskyrų nepašalina.
 *
 * SAUGU PAGAL NUTYLĖJIMĄ: be `--confirm` skriptas tik SUSKAIČIUOJA ir nieko netrina.
 *
 * Kaip paleisti (Google Cloud Shell — jokio Node diegimo nereikia):
 *   1) Atsidaryk https://console.cloud.google.com  ->  pasirink teisingą projektą
 *      ->  spausk „Activate Cloud Shell" (terminalo ikona viršuje).
 *   2) git clone <repo>  &&  cd wc2026-totalizatorius
 *   3) npm install firebase-admin
 *   4) SAUSAS BANDYMAS (nieko netrina, tik parodo skaičių):
 *        node scripts/delete-auth-users.cjs --project TAVO_PROJECT_ID
 *   5) Kai skaičius atrodo teisingas — REALUS trynimas:
 *        node scripts/delete-auth-users.cjs --project TAVO_PROJECT_ID --confirm
 *
 * Autentifikacija: naudoja Application Default Credentials — Cloud Shell'e tai
 * tavo paties Google paskyra (projekto savininkas), tad service account rakto
 * nereikia. Norint paleisti lokaliai — pirma `gcloud auth application-default login`.
 */

const admin = require('firebase-admin');

// --- Argumentų parsinimas ---
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

// El. pašto maskavimas, kad terminalo logas be reikalo nerodytų viso PII.
const maskEmail = (email) => {
  if (!email) return '(be el. pašto)';
  const [name, domain] = email.split('@');
  if (!domain) return '***';
  const head = name.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
};

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId,
});

async function collectAllUsers() {
  const uids = [];
  const sample = [];
  let nextPageToken;
  do {
    const res = await admin.auth().listUsers(1000, nextPageToken);
    res.users.forEach((u) => {
      uids.push(u.uid);
      if (sample.length < 5) sample.push(maskEmail(u.email));
    });
    nextPageToken = res.pageToken;
  } while (nextPageToken);
  return { uids, sample };
}

async function main() {
  console.log(`\nProjektas: ${projectId}`);
  console.log(`Režimas:   ${confirm ? 'REALUS TRYNIMAS' : 'SAUSAS BANDYMAS (nieko netrinama)'}\n`);

  const { uids, sample } = await collectAllUsers();

  console.log(`Rasta Authentication paskyrų: ${uids.length}`);
  if (sample.length > 0) {
    console.log('Pavyzdys (užmaskuota):');
    sample.forEach((s) => console.log(`  - ${s}`));
  }

  if (uids.length === 0) {
    console.log('\nNėra ką trinti. Baigta.');
    return;
  }

  if (!confirm) {
    console.log('\nTai buvo tik sausas bandymas — niekas neištrinta.');
    console.log('Kai skaičius atrodo teisingas, paleisk tą pačią komandą su  --confirm');
    return;
  }

  console.log('\nTrinama...');
  let deleted = 0;
  let failed = 0;
  for (let i = 0; i < uids.length; i += 1000) {
    const chunk = uids.slice(i, i + 1000);
    const res = await admin.auth().deleteUsers(chunk);
    deleted += res.successCount;
    failed += res.failureCount;
    if (res.failureCount > 0) {
      res.errors.forEach((e) => console.warn(`  Nepavyko (index ${e.index}): ${e.error.message}`));
    }
    console.log(`  ...ištrinta ${deleted} / ${uids.length}`);
  }

  console.log(`\nBAIGTA. Ištrinta: ${deleted}. Nepavyko: ${failed}.`);
  if (failed === 0) {
    console.log('Visos Authentication paskyros pašalintos.');
  }
}

main().catch((err) => {
  console.error('\nKLAIDA:', err.message);
  process.exit(1);
});
