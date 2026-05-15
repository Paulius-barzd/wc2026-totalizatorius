# PFČ 2026 Totalizatorius

Pasaulio Futbolo Čempionato 2026 vidinis totalizatorius. Tech stack: React + Vite + Firebase + Tailwind.

## Funkcijos

- ✅ Vartotojų registracija ir prisijungimas (Firebase Auth)
- ✅ Rungtynių rezultatų prognozavimas
- ✅ Turnyro prognozės (čempionas, geriausias strielcas, grupių nugalėtojai)
- ✅ Realaus laiko lyderlentė
- ✅ Admin valdymo skydas rezultatų suvedimui
- ✅ Saugumas per Firestore Security Rules

## Taškų sistema

- Tikslus rezultatas: **5 tšk.**
- Teisingas gol skirtumas (bet ne tikslus rezultatas): **3 tšk.**
- Teisinga baigtis (laimėtojas/lygiosios): **2 tšk.**
- Čempionas: 25 tšk., Strielcas: 15 tšk., Grupių nugalėtojai: po 5 tšk.

## Deployment (Netlify)

### 1. Pirmas deploy'as

Detalios instrukcijos atskirame chat'e su asistentu.

Trumpa eiga:
1. Įkelk visus failus į GitHub repository
2. Netlify.com → "Add new site" → "Import existing project"
3. Pasirink GitHub repository
4. Build settings:
   - Build command: `npm run build`
   - Publish directory: `dist`
5. Environment variables - pridėk visus 6 `VITE_FIREBASE_*` kintamuosius
6. Deploy site

### 2. Firebase Security Rules

Po pirmos sėkmingos deploy'o, eik į Firebase Console → Firestore → Rules ir įkelk
`firestore.rules` failo turinį. Tai BŪTINA - be tinkamų rules duomenys nesaugūs.

### 3. Authorized domains

Firebase Console → Authentication → Settings → Authorized domains → pridėk savo
Netlify domeną (pvz., `wc2026-totalizatorius.netlify.app`).

### 4. Suteikti pirmam admin'ui teises

Po pirmos registracijos:
1. Firebase Console → Firestore Database → `users` kolekcija
2. Surask savo user dokumentą
3. Edit field: `isAdmin` → `true`
4. Atsijunk ir prisijunk iš naujo
5. Profilio ekrane atsiras "Administratoriaus skydas" mygtukas

### 5. Demo rungtynių sukūrimas

Pirmą kartą prisijungęs kaip admin, eik į Administratoriaus skydą →
"Sukurti demo rungtynes". Tai sukurs 8 testines rungtynes.

## Testavimo eiga

1. Užregistruok 2-3 vartotojus skirtingais el. paštais
2. Vienu vartotoju (kuris pirmas registravosi) - padaryk admin per Firebase Console
3. Admin sukuria demo rungtynes
4. Visi vartotojai daro prognozes
5. Admin nustato rezultatą rungtynei → status `finished`
6. Lyderlentė atsinaujina realiu laiku, taškai perskaičiuojami

## Saugumas

- Slaptažodžiai saugomi Firebase Auth (bcrypt hash)
- Visi duomenys siunčiami per HTTPS
- Firestore Rules užkerta neteisėtą prieigą prie duomenų
- Vartotojas negali pakeisti savo isAdmin lauko
- Prognozes galima keisti tik iki rungtynių pradžios (server-side patikrinimas)
- Admin teisės suteikiamos tik per Firebase Console (ne per aplikaciją)

## Lokalus development (jei turi Node.js)

```bash
npm install
npm run dev
```

Aplikacija bus pasiekiama http://localhost:5173

## Failų struktūra

```
wc2026-app/
├── .env.example         # Environment kintamųjų šablonas
├── .gitignore           # Failai neicommit'inami į Git
├── firestore.rules      # Firestore saugumo taisyklės
├── index.html           # HTML entry point
├── netlify.toml         # Netlify build konfigūracija
├── package.json         # Dependencies
├── postcss.config.js    # PostCSS (Tailwind)
├── tailwind.config.js   # Tailwind CSS
├── vite.config.js       # Vite build tool
└── src/
    ├── App.jsx          # Pagrindinė aplikacija (visi ekranai)
    ├── firebase.js      # Firebase prisijungimas ir helper'iai
    ├── index.css        # Globalūs stiliai
    └── main.jsx         # React entry point
```
