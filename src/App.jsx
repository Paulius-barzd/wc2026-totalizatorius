import { useState, useEffect, useMemo } from 'react';
import {
  Trophy, Home, Calendar, BarChart3, Lock, Settings,
  Award, Crown, Target, Star, Flame, Plus, Minus, Shield,
  ChevronRight, ChevronLeft, Radio, LogOut, Loader2,
  AlertCircle, CheckCircle2, BookOpen, Info, Gift, Pencil, X,
} from 'lucide-react';
import {
  registerUser, loginUser, logoutUser, onAuthChange, requestPasswordReset, deleteUserAccount, updateOwnFullName,
  acceptPolicyConsent, CURRENT_POLICY_VERSION,
  getUserProfile, savePrediction, saveTournamentBet, getTournamentBet,
  listenToMatches, listenToUserPredictions, listenToFinishedPredictions, listenToUsers, listenToCompanies,
  listenToUsersPrivate, migrateUsersToPrivateSchema,
  listenToAllTournamentBets, listenToTournamentResults, saveTournamentResults,
  updateMatch, seedDemoMatches, seedWC2026Matches, deleteDemoMatches, syncResultsFromAPI, migrateAddKickoffMs,
  createCompany, updateCompany, deleteCompany, setUserAdmin, setUserCompany,
  seedKnockoutStructure,
  TOURNAMENT_LOCK_TIME,
} from './firebase';

// ============================================================
// CONSTANTS
// ============================================================

const teamsByCode = {
  // === Group A ===
  MEX: { name: 'Meksika', code: 'mx' },
  RSA: { name: 'Pietų Afrika', code: 'za' },
  KOR: { name: 'Pietų Korėja', code: 'kr' },
  CZE: { name: 'Čekija', code: 'cz' },
  // === Group B ===
  CAN: { name: 'Kanada', code: 'ca' },
  SUI: { name: 'Šveicarija', code: 'ch' },
  QAT: { name: 'Kataras', code: 'qa' },
  BIH: { name: 'Bosnija ir Hercegovina', code: 'ba' },
  // === Group C ===
  BRA: { name: 'Brazilija', code: 'br' },
  MAR: { name: 'Marokas', code: 'ma' },
  HAI: { name: 'Haitis', code: 'ht' },
  SCO: { name: 'Škotija', code: 'gb-sct' },
  // === Group D ===
  USA: { name: 'Jungtinės Amerikos Valstijos', code: 'us' },
  PAR: { name: 'Paragvajus', code: 'py' },
  AUS: { name: 'Australija', code: 'au' },
  TUR: { name: 'Turkija', code: 'tr' },
  // === Group E ===
  GER: { name: 'Vokietija', code: 'de' },
  CUW: { name: 'Kiurasao', code: 'cw' },
  CIV: { name: 'Dramblio Kaulo Krantas', code: 'ci' },
  ECU: { name: 'Ekvadoras', code: 'ec' },
  // === Group F ===
  NED: { name: 'Nyderlandai', code: 'nl' },
  JPN: { name: 'Japonija', code: 'jp' },
  SWE: { name: 'Švedija', code: 'se' },
  TUN: { name: 'Tunisas', code: 'tn' },
  // === Group G ===
  BEL: { name: 'Belgija', code: 'be' },
  EGY: { name: 'Egiptas', code: 'eg' },
  IRN: { name: 'Iranas', code: 'ir' },
  NZL: { name: 'Naujoji Zelandija', code: 'nz' },
  // === Group H ===
  ESP: { name: 'Ispanija', code: 'es' },
  CPV: { name: 'Žaliasis Kyšulys', code: 'cv' },
  KSA: { name: 'Saudo Arabija', code: 'sa' },
  URU: { name: 'Urugvajus', code: 'uy' },
  // === Group I ===
  FRA: { name: 'Prancūzija', code: 'fr' },
  SEN: { name: 'Senegalas', code: 'sn' },
  NOR: { name: 'Norvegija', code: 'no' },
  IRQ: { name: 'Irakas', code: 'iq' },
  // === Group J ===
  ARG: { name: 'Argentina', code: 'ar' },
  ALG: { name: 'Alžyras', code: 'dz' },
  AUT: { name: 'Austrija', code: 'at' },
  JOR: { name: 'Jordanija', code: 'jo' },
  // === Group K ===
  POR: { name: 'Portugalija', code: 'pt' },
  COD: { name: 'Kongo DR', code: 'cd' },
  UZB: { name: 'Uzbekistanas', code: 'uz' },
  COL: { name: 'Kolumbija', code: 'co' },
  // === Group L ===
  ENG: { name: 'Anglija', code: 'gb-eng' },
  CRO: { name: 'Kroatija', code: 'hr' },
  GHA: { name: 'Gana', code: 'gh' },
  PAN: { name: 'Panama', code: 'pa' },
};

// Knockout etapų lietuviški pavadinimai (rodomi MatchCard header'yje)
const STAGE_LABELS = {
  round_of_32: '1/16 finalas',
  round_of_16: 'Aštuntfinalis',
  quarter_final: 'Ketvirtfinalis',
  semi_final: 'Pusfinalis',
  third_place: 'Dėl 3 vietos',
  final: 'Finalas',
};

// ============================================================
// HELPERS
// ============================================================

const calculatePoints = (predicted, actual) => {
  if (!predicted || !actual) return { pts: 0, type: null };
  if (predicted.home === actual.home && predicted.away === actual.away) {
    return { pts: 5, type: 'exact' };
  }
  const pDiff = predicted.home - predicted.away;
  const aDiff = actual.home - actual.away;
  if (pDiff === aDiff) return { pts: 3, type: 'diff' };
  const sameOutcome =
    (pDiff > 0 && aDiff > 0) ||
    (pDiff < 0 && aDiff < 0) ||
    (pDiff === 0 && aDiff === 0);
  if (sameOutcome) return { pts: 2, type: 'outcome' };
  return { pts: 0, type: 'wrong' };
};

const formatKickoff = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const days = ['Sek', 'Pir', 'Ant', 'Tre', 'Ket', 'Pen', 'Šeš'];
  const months = ['saus', 'vas', 'kov', 'bal', 'geg', 'birž', 'liep', 'rugp', 'rugs', 'spal', 'lapk', 'gruod'];

  // Naudoti Intl.DateTimeFormat su Europe/Vilnius - visada Lietuvos laiku,
  // nepriklausomai nuo naršyklės lokalios juostos
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Vilnius',
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const wMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const wkd = wMap[get('weekday')] ?? 0;
  const day = parseInt(get('day'), 10);
  const month = parseInt(get('month'), 10) - 1;

  return `${days[wkd]}, ${day} ${months[month]} · ${get('hour')}:${get('minute')}`;
};

const timeUntil = (iso) => {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  const diff = target - Date.now();
  if (diff <= 0) return null;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff / 3600000) % 24);
  const mins = Math.floor((diff / 60000) % 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
};

// Normalizuoti žaidėjo vardą palyginimui (case-insensitive, trim, dvigubi space'ai)
const normalizeName = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Apskaičiuoja taškus už turnyro prognozę pagal admin'o suvestus rezultatus.
// Grąžina objektą: { champion, bestPlayer, topScorer, bestGoalkeeper, bestYoungPlayer, total }
const calculateTournamentPoints = (bet, results) => {
  const pts = { champion: 0, bestPlayer: 0, topScorer: 0, bestGoalkeeper: 0, bestYoungPlayer: 0, total: 0 };
  if (!bet || !results) return pts;
  if (bet.champion && results.champion && bet.champion === results.champion) {
    pts.champion = 25;
  }
  const playerFields = ['bestPlayer', 'topScorer', 'bestGoalkeeper', 'bestYoungPlayer'];
  playerFields.forEach((key) => {
    if (bet[key] && results[key] && normalizeName(bet[key]) === normalizeName(results[key])) {
      pts[key] = 15;
    }
  });
  pts.total = pts.champion + pts.bestPlayer + pts.topScorer + pts.bestGoalkeeper + pts.bestYoungPlayer;
  return pts;
};

// Trumpinys ikonai - pirmenybė įmonės oficialus code, fallback į pirmą pavadinimo raidę
const companyAbbreviation = (company) => {
  if (!company) return '?';
  if (company.code) return company.code;
  return (company.name || '?')[0].toUpperCase();
};

// LT linksniavimas pagal skaičių: 1 dalyvis, 2-9 dalyviai, 10-19 dalyvių,
// 20 dalyvių, 21 dalyvis, 22-29 dalyviai ir t.t.
const pluralizeLt = (n, forms) => {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 0 || (mod100 >= 11 && mod100 <= 19)) return forms[2];
  if (mod10 === 1) return forms[0];
  return forms[1];
};

const translateAuthError = (code) => {
  const map = {
    'auth/invalid-email': 'Neteisingas el. pašto formatas',
    'auth/email-already-in-use': 'Šis el. paštas jau užregistruotas',
    'auth/weak-password': 'Per silpnas slaptažodis (bent 8 simboliai, su raide ir skaičiumi)',
    // Anti-enumeration: nesakome ar paskyra egzistuoja - tas pats pranešimas abiem atvejais
    'auth/user-not-found': 'Neteisingas el. paštas arba slaptažodis',
    'auth/wrong-password': 'Neteisingas el. paštas arba slaptažodis',
    'auth/invalid-credential': 'Neteisingas el. paštas arba slaptažodis',
    'auth/too-many-requests': 'Per daug bandymų - palaukite kelias minutes',
    'auth/network-request-failed': 'Nepavyko prisijungti prie tinklo',
  };
  return map[code] || null;
};

// ============================================================
// STYLES
// ============================================================

const Styles = () => (
  <style>{`
    .font-display { font-family: 'Montserrat', system-ui, sans-serif; font-weight: 900; letter-spacing: -0.02em; }
    .font-body { font-family: 'Montserrat', system-ui, sans-serif; font-weight: 500; }
    .font-mono { font-family: 'JetBrains Mono', monospace; }

    .app-bg {
      background:
        radial-gradient(circle at 0% 0%, rgba(209, 169, 116, 0.08) 0%, transparent 40%),
        radial-gradient(circle at 100% 100%, rgba(84, 19, 14, 0.04) 0%, transparent 40%),
        #FFFFFF;
      min-height: 100vh;
    }

    .glass-light {
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid rgba(84, 19, 14, 0.1);
    }

    .card-light {
      background: #ffffff;
      border: 1px solid rgba(84, 19, 14, 0.1);
      box-shadow: 0 1px 2px rgba(84, 19, 14, 0.04), 0 4px 12px rgba(84, 19, 14, 0.05);
    }

    .flag-img {
      border-radius: 3px;
      box-shadow: 0 1px 2px rgba(68, 21, 20, 0.15);
      outline: 1px solid rgba(68, 21, 20, 0.08);
      outline-offset: -1px;
    }

    @keyframes pulse-live {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .pulse-live { animation: pulse-live 1.4s ease-in-out infinite; }

    .scrollbar-hide::-webkit-scrollbar { display: none; }
    .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }

    .paper-grain::before {
      content: '';
      position: absolute;
      inset: 0;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E");
      opacity: 0.06;
      pointer-events: none;
      mix-blend-mode: multiply;
    }
  `}</style>
);

// ============================================================
// SVG FLAGS (16 vėliavų, inline SVG - nereikia interneto)
// ============================================================

const FLAGS = {
  mx: <><rect x="0" width="10" height="20" fill="#006847"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#ce1126"/><ellipse cx="15" cy="10" rx="2.5" ry="1.8" fill="#7a4f25" opacity="0.5"/></>,
  ca: <><rect width="30" height="20" fill="#fff"/><rect x="0" width="7.5" height="20" fill="#d52b1e"/><rect x="22.5" width="7.5" height="20" fill="#d52b1e"/><path d="M15,4 L15.6,6.8 L17.6,5.9 L16.8,8.5 L18.6,8.7 L17.1,10.2 L18.1,12.5 L15.7,11.7 L15.5,15.3 L15,16.2 L14.5,15.3 L14.3,11.7 L11.9,12.5 L12.9,10.2 L11.4,8.7 L13.2,8.5 L12.4,5.9 L14.4,6.8 Z" fill="#d52b1e"/></>,
  us: <><rect width="30" height="20" fill="#b22234"/><rect y="1.54" width="30" height="1.54" fill="#fff"/><rect y="4.62" width="30" height="1.54" fill="#fff"/><rect y="7.69" width="30" height="1.54" fill="#fff"/><rect y="10.77" width="30" height="1.54" fill="#fff"/><rect y="13.85" width="30" height="1.54" fill="#fff"/><rect y="16.92" width="30" height="1.54" fill="#fff"/><rect width="12" height="10.77" fill="#3c3b6e"/></>,
  pt: <><rect width="30" height="20" fill="#da291c"/><rect width="12" height="20" fill="#046a38"/><circle cx="12" cy="10" r="3" fill="#fff" stroke="#fdb913" strokeWidth="0.4"/><circle cx="12" cy="10" r="1.7" fill="#002776"/></>,
  kr: <><rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="4.5" fill="#cd2e3a"/><path d="M15,5.5 A4.5,4.5 0 0,0 15,14.5 A2.25,2.25 0 0,1 15,10 A2.25,2.25 0 0,0 15,5.5 Z" fill="#0047a0"/></>,
  es: <><rect width="30" height="20" fill="#aa151b"/><rect y="5" width="30" height="10" fill="#f1bf00"/><rect x="6" y="8" width="2.5" height="4" fill="#aa151b" opacity="0.7"/></>,
  de: <><rect width="30" height="6.67" fill="#000"/><rect y="6.67" width="30" height="6.67" fill="#dd0000"/><rect y="13.33" width="30" height="6.67" fill="#ffce00"/></>,
  br: <><rect width="30" height="20" fill="#009c3b"/><polygon points="15,3 26,10 15,17 4,10" fill="#ffdf00"/><circle cx="15" cy="10" r="3.5" fill="#002776"/><path d="M11.5,9.5 Q15,7.5 18.5,9.5" stroke="#fff" strokeWidth="0.4" fill="none"/></>,
  ar: <><rect width="30" height="6.67" fill="#75aadb"/><rect y="6.67" width="30" height="6.67" fill="#fff"/><rect y="13.33" width="30" height="6.67" fill="#75aadb"/><circle cx="15" cy="10" r="1.4" fill="#fcbf49"/></>,
  fr: <><rect width="10" height="20" fill="#002395"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#ed2939"/></>,
  'gb-eng': <><rect width="30" height="20" fill="#fff"/><rect x="13" width="4" height="20" fill="#ce1124"/><rect y="8" width="30" height="4" fill="#ce1124"/></>,
  nl: <><rect width="30" height="6.67" fill="#ae1c28"/><rect y="6.67" width="30" height="6.67" fill="#fff"/><rect y="13.33" width="30" height="6.67" fill="#21468b"/></>,
  hr: <><rect width="30" height="6.67" fill="#ff0000"/><rect y="6.67" width="30" height="6.67" fill="#fff"/><rect y="13.33" width="30" height="6.67" fill="#171796"/><rect x="13" y="6.5" width="4" height="7" fill="#fff"/><rect x="13.5" y="7" width="3" height="6" fill="#ff0000"/></>,
  jp: <><rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="6" fill="#bc002d"/></>,
  it: <><rect width="10" height="20" fill="#009246"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#ce2b37"/></>,
  be: <><rect width="10" height="20" fill="#000"/><rect x="10" width="10" height="20" fill="#fae042"/><rect x="20" width="10" height="20" fill="#ed2939"/></>,
};

// ============================================================
// VISUAL COMPONENTS
// ============================================================

const Flag = ({ code, className = 'w-8 h-6' }) => {
  if (!code) {
    return (
      <div className={`${className} bg-[#441514]/10 rounded-sm flex items-center justify-center`}>
        <span className="text-[8px] font-bold uppercase text-[#845641]">?</span>
      </div>
    );
  }
  const flagContent = FLAGS[code];
  // Inline SVG (16 esamos vėliavos) - greitas, neturi network requestų
  if (flagContent) {
    return (
      <span className={`inline-block overflow-hidden flag-img ${className}`} style={{ verticalAlign: 'middle' }}>
        <svg viewBox="0 0 30 20" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" style={{ display: 'block' }}>
          {flagContent}
        </svg>
      </span>
    );
  }
  // Fallback: flagcdn.com (32 naujos vėliavos iš WC 2026)
  return (
    <span className={`inline-block overflow-hidden rounded-sm ${className}`} style={{ verticalAlign: 'middle' }}>
      <img
        src={`https://flagcdn.com/${code}.svg`}
        alt={code}
        className="w-full h-full"
        style={{ display: 'block', objectFit: 'cover' }}
        loading="lazy"
      />
    </span>
  );
};

// VMG logotipas. Jei /public/vmg-mark.png (arba .svg) yra įkeltas, naudojamas tikras logo.
// Jei nėra - fallback'as į stilizuotą inline SVG „W" mark'ą.
// Norint įkelti tikrą logo: StackBlitz'e public/ folder'is → New file → vmg-mark.png/svg → įkelti.
const Emblem = ({ className = 'w-16 h-16', variant = 'dark', full = false }) => {
  const [imageError, setImageError] = useState(false);

  // Pirma bandyti realų logo iš /public
  if (!imageError) {
    const src = full ? '/vmg-logo-full.png' : '/vmg-mark.png';
    return (
      <img
        src={src}
        alt="VMG"
        className={className}
        onError={() => setImageError(true)}
        style={{ objectFit: 'contain' }}
      />
    );
  }

  // Fallback - inline SVG su VMG brand spalvomis
  const isDark = variant === 'dark';
  const gradId = `vmg-grad-${variant}`;
  const stops = isDark
    ? [{ offset: '0%', color: '#D1A974' }, { offset: '50%', color: '#FFFFFF' }, { offset: '100%', color: '#D1A974' }]
    : [{ offset: '0%', color: '#D1A974' }, { offset: '50%', color: '#FFFFFF' }, { offset: '100%', color: '#845641' }];
  const shadowFill = isDark ? '#441514' : '#54130E';

  return (
    <svg viewBox="0 0 100 100" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          {stops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} />)}
        </linearGradient>
      </defs>
      <path d="M 10 28 Q 20 20, 30 28 L 45 75 Q 35 80, 25 75 Z" fill={`url(#${gradId})`} />
      <path d="M 28 30 L 38 70 L 32 70 L 22 32 Z" fill={shadowFill} opacity="0.85" />
      <path d="M 35 28 Q 50 18, 65 28 L 60 75 Q 45 80, 40 75 Z" fill={`url(#${gradId})`} />
      <path d="M 50 30 L 50 70 L 44 70 L 44 32 Z" fill={shadowFill} opacity="0.85" />
      <path d="M 65 28 Q 78 22, 88 30 Q 90 50, 85 72 L 70 75 Q 60 70, 60 60 Z" fill={`url(#${gradId})`} />
      <path d="M 70 32 L 80 65 L 74 70 L 64 35 Z" fill={shadowFill} opacity="0.85" />
    </svg>
  );
};

// Mažas 2026 metų badge'as - prisitaiko prie VMG brand
const YearBadge = ({ className = '', variant = 'dark' }) => {
  const isDark = variant === 'dark';
  return (
    <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md font-display text-xs ${className}`}
      style={{
        backgroundColor: isDark ? '#D1A974' : '#54130E',
        color: isDark ? '#54130E' : '#FFFFFF',
        letterSpacing: '0.1em',
      }}>
      2026
    </span>
  );
};

const StatusBadge = ({ status }) => {
  if (status === 'live') {
    return (
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#6A1107]/10 border border-[#6A1107]/25">
        <span className="w-1.5 h-1.5 rounded-full bg-[#6A1107] pulse-live" />
        <span className="text-[10px] font-bold text-[#6A1107] uppercase tracking-wider">Tiesiogiai</span>
      </div>
    );
  }
  if (status === 'finished') {
    return (
      <div className="px-2 py-0.5 rounded-full bg-[#441514]/5 border border-[#441514]/10">
        <span className="text-[10px] font-bold text-[#845641] uppercase tracking-wider">Baigta</span>
      </div>
    );
  }
  return null;
};

const PointsBadge = ({ points, type }) => {
  const styles = {
    exact: 'bg-[#54130E]/10 text-[#54130E] border-[#54130E]/25',
    diff: 'bg-[#D1A974]/10 text-[#D1A974] border-[#D1A974]/25',
    outcome: 'bg-[#54130E]/10 text-[#54130E] border-[#54130E]/25',
    wrong: 'bg-[#441514]/5 text-[#845641] border-[#441514]/10',
  };
  const labels = { exact: 'Tikslus!', diff: 'Skirtumas', outcome: 'Baigtis', wrong: 'Pro šalį' };
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md border ${styles[type]}`}>
      <span className="text-[10px] font-bold uppercase tracking-wider">{labels[type]}</span>
      <span className="font-mono text-xs font-bold">+{points}</span>
    </div>
  );
};

const ScoreInput = ({ value, onChange, disabled }) => (
  <div className="flex items-center gap-1">
    <button
      onClick={() => onChange(Math.max(0, value - 1))}
      disabled={disabled}
      className="w-7 h-7 rounded-md bg-[#441514]/5 border border-[#441514]/10 flex items-center justify-center text-[#845641] hover:bg-[#441514]/10 hover:text-[#441514] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      <Minus className="w-3.5 h-3.5" />
    </button>
    <div className={`w-10 h-10 rounded-md flex items-center justify-center font-mono font-bold text-xl ${
      disabled ? 'bg-[#441514]/5 text-[#845641]' : 'bg-[#54130E]/10 text-[#54130E] border border-[#54130E]/30'
    }`}>
      {value}
    </div>
    <button
      onClick={() => onChange(Math.min(9, value + 1))}
      disabled={disabled}
      className="w-7 h-7 rounded-md bg-[#441514]/5 border border-[#441514]/10 flex items-center justify-center text-[#845641] hover:bg-[#441514]/10 hover:text-[#441514] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      <Plus className="w-3.5 h-3.5" />
    </button>
  </div>
);

const TeamBlock = ({ code }) => {
  const team = teamsByCode[code];
  if (!team) return null;
  return (
    <div className="flex flex-col items-center gap-2 min-w-0">
      <Flag code={team.code} className="w-12 h-8" />
      <span className="text-[11px] font-bold text-[#441514] leading-tight text-center px-1">
        {team.name}
      </span>
    </div>
  );
};

const MatchCard = ({ match, prediction, onUpdatePrediction }) => {
  const isLocked = match.status !== 'upcoming';
  const tu = timeUntil(match.kickoff);

  // Lokalus state - kas dabar redaguojama
  const [localPred, setLocalPred] = useState({
    home: prediction?.home ?? 0,
    away: prediction?.away ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // Edit mode: jei nėra išsaugotos prognozės, iškart edit mode
  const [isEditing, setIsEditing] = useState(!prediction);

  // Sinchronizuoti lokalų state kai prediction iš Firestore pasikeičia
  useEffect(() => {
    if (prediction) {
      setLocalPred({ home: prediction.home, away: prediction.away });
    } else {
      setIsEditing(true);
    }
  }, [prediction?.home, prediction?.away]);

  const hasChanges = !prediction
    ? true
    : prediction.home !== localPred.home || prediction.away !== localPred.away;

  let pointsResult = null;
  if (match.status === 'finished' && prediction) {
    pointsResult = calculatePoints(prediction, match.actualScore);
  }

  const handleSave = async () => {
    if (isLocked || !hasChanges || saving) return;
    setSaving(true);
    try {
      await onUpdatePrediction(match.id, localPred);
      setJustSaved(true);
      setIsEditing(false); // Po išsaugojimo - grįžti į view mode
      setTimeout(() => setJustSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (prediction) {
      setLocalPred({ home: prediction.home, away: prediction.away });
    }
    setIsEditing(false);
  };

  // Input'ų disabled būsena
  const inputsDisabled = isLocked || saving || (!isEditing && prediction);

  return (
    <div className="card-light rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {match.stage && match.stage !== 'group' ? (
            <span className="text-[10px] font-bold text-[#54130E] uppercase tracking-wider">
              {STAGE_LABELS[match.stage] || match.stage}
            </span>
          ) : (
            <span className="text-[10px] font-bold text-[#845641] uppercase tracking-wider">
              Grupė {match.group}
            </span>
          )}
          <span className="text-[#A88A6F]">·</span>
          <span className="text-[10px] text-[#845641]">{formatKickoff(match.kickoff)}</span>
        </div>
        <StatusBadge status={match.status} />
      </div>

      <div className="grid grid-cols-3 items-center gap-3 mb-3">
        <TeamBlock code={match.home} />
        <div className="flex flex-col items-center">
          {(match.status === 'finished' || match.status === 'live') && match.actualScore ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#441514]/5 border border-[#441514]/10">
              <span className="font-display text-2xl text-[#441514]">{match.actualScore.home}</span>
              <span className="text-[#A88A6F]">:</span>
              <span className="font-display text-2xl text-[#441514]">{match.actualScore.away}</span>
            </div>
          ) : (
            <div className="px-3 py-1.5 rounded-lg bg-[#441514]/5 border border-[#441514]/10">
              <span className="font-mono text-xs text-[#845641]">vs</span>
            </div>
          )}
        </div>
        <TeamBlock code={match.away} />
      </div>

      <div className="border-t border-[#441514]/10 pt-3 mt-3">
        {match.status === 'upcoming' && (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold text-[#54130E] uppercase tracking-wider flex items-center gap-1">
                <Target className="w-3 h-3" /> {prediction ? 'Tavo spėjimas' : 'Tavo prognozė'}
              </span>
              {tu && (
                <span className="text-[10px] font-mono text-[#845641]">
                  Iki uždarymo liko {tu}
                </span>
              )}
            </div>
            <div className="flex items-center justify-center gap-3 mb-3">
              <ScoreInput value={localPred.home}
                onChange={(v) => setLocalPred({ ...localPred, home: v })}
                disabled={inputsDisabled} />
              <span className="text-[#845641] font-mono">:</span>
              <ScoreInput value={localPred.away}
                onChange={(v) => setLocalPred({ ...localPred, away: v })}
                disabled={inputsDisabled} />
            </div>

            {/* VIEW MODE: tik Redaguoti spėjimą mygtukas */}
            {!isEditing && prediction && (
              <button onClick={() => setIsEditing(true)}
                style={{ backgroundColor: '#FAF0E0', color: '#54130E', border: '1px solid rgba(84, 19, 14, 0.2)' }}
                className="w-full py-2 rounded-lg text-xs font-bold uppercase tracking-wider hover:opacity-80 transition-all">
                Redaguoti spėjimą
              </button>
            )}

            {/* EDIT MODE: Save (+ Atšaukti jei jau buvo prognozė) */}
            {(isEditing || !prediction) && (
              <div className="flex gap-2">
                {prediction && (
                  <button onClick={handleCancel} disabled={saving}
                    style={{ backgroundColor: '#ffffff', color: '#845641', border: '1px solid rgba(68, 21, 20, 0.2)' }}
                    className="flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider disabled:opacity-50 hover:bg-[#441514]/5 transition-all">
                    Atšaukti
                  </button>
                )}
                <button onClick={handleSave} disabled={!hasChanges || saving || justSaved}
                  style={(!hasChanges || justSaved) && !saving
                    ? { backgroundColor: '#FAF0E0', color: '#845641' }
                    : { background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)', color: '#ffffff' }}
                  className={`${prediction ? 'flex-1' : 'w-full'} py-2 rounded-lg text-xs font-bold uppercase tracking-wider disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md transition-all duration-200 hover:scale-[1.02] hover:brightness-110 hover:shadow-lg active:scale-[0.98]`}>
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {justSaved && <CheckCircle2 className="w-3.5 h-3.5" />}
                  {saving ? 'Saugoma...' : justSaved ? 'Išsaugota' : prediction ? 'Atnaujinti' : 'Patvirtinti spėjimą'}
                </button>
              </div>
            )}
          </>
        )}

        {match.status === 'live' && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-[#845641]" />
              {prediction ? (
                <span className="text-xs text-[#845641]">
                  Tavo spėjimas: <span className="font-mono font-bold text-[#441514]">{prediction.home}:{prediction.away}</span>
                </span>
              ) : (
                <span className="text-xs text-[#6A1107]">Nespėjai pažymėti prognozės</span>
              )}
            </div>
          </div>
        )}

        {match.status === 'finished' && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {prediction ? (
                <span className="text-xs text-[#845641]">
                  Spėjo: <span className="font-mono font-bold text-[#441514]">{prediction.home}:{prediction.away}</span>
                </span>
              ) : (
                <span className="text-xs text-[#845641]">Nespėjai pažymėti</span>
              )}
            </div>
            {pointsResult && <PointsBadge points={pointsResult.pts} type={pointsResult.type} />}
          </div>
        )}
      </div>
    </div>
  );
};

const TeamPickButton = ({ code, selected, onClick, accentColor, disabled = false }) => {
  const team = teamsByCode[code];
  if (!team) return null;
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-all ${
        selected ? 'scale-105' : 'bg-[#FFFFFF] border-[#441514]/8 hover:border-[#441514]/20'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      style={selected ? { backgroundColor: `${accentColor}15`, borderColor: `${accentColor}60` } : {}}>
      <Flag code={team.code} className="w-12 h-8" />
      <span className="text-[11px] font-semibold text-[#441514] text-center leading-tight min-h-[28px] flex items-center">
        {team.name}
      </span>
      {selected && <Star className="w-3 h-3 fill-current" style={{ color: accentColor }} />}
    </button>
  );
};

const FormField = ({ label, type = 'text', placeholder, value, onChange, autoComplete }) => (
  <div>
    <label className="text-[10px] font-bold text-[#845641] uppercase tracking-wider block mb-1.5">{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      className="w-full px-4 py-3 rounded-lg bg-[#FFFFFF] border border-[#441514]/15 text-[#441514] placeholder-[#A88A6F] focus:outline-none focus:border-[#54130E] focus:ring-2 focus:ring-[#54130E]/15 hover:border-[#845641]/30 font-medium transition-all"
    />
  </div>
);

// Futbolo kamuolio ikona - klasiškas line art stilius, currentColor adaptuojasi.
// Efektai (gradient fonas, hover scale/rotate) yra ikonos WRAPPER'yje, ne čia.
const FootballIcon = ({ className = 'w-5 h-5' }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polygon points="12,7 16,10 14.5,15 9.5,15 8,10" />
    <line x1="12" y1="7" x2="12" y2="3" />
    <line x1="16" y1="10" x2="20" y2="9" />
    <line x1="8" y1="10" x2="4" y2="9" />
    <line x1="14.5" y1="15" x2="17.5" y2="19" />
    <line x1="9.5" y1="15" x2="6.5" y2="19" />
  </svg>
);

const ErrorAlert = ({ message }) => message ? (
  <div className="flex items-start gap-2 p-3 rounded-lg bg-[#6A1107]/10 border border-[#6A1107]/30 mb-3">
    <AlertCircle className="w-4 h-4 text-[#6A1107] flex-shrink-0 mt-0.5" />
    <span className="text-sm text-[#6A1107]">{message}</span>
  </div>
) : null;

// === MODAL DIALOG (custom confirm/alert) ===

const ModalOverlay = ({ children, onClose }) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#441514]/60 backdrop-blur-sm"
    onClick={onClose}>
    <div
      className="card-light rounded-2xl p-5 max-w-sm w-full"
      onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  </div>
);

// Vienkartinis pranešimas po prisijungimo apie 2026-06-15 lyderlentės pataisymą.
// Rodomas tik kartą per naršyklę (localStorage), ir tik iki ANNOUNCEMENT_EXPIRY datos —
// po jos net naujiems vartotojams nebepasirodys, kad nesivertė nebeaktualios žinutės.
const ANNOUNCEMENT_ID = 'leaderboardFix_2026_06_15';
const ANNOUNCEMENT_EXPIRY_MS = new Date('2026-06-30T00:00:00Z').getTime();

const LeaderboardFixAnnouncement = ({ onDismiss }) => (
  <ModalOverlay onClose={onDismiss}>
    <div className="flex items-center gap-2 mb-3">
      <CheckCircle2 className="w-5 h-5 flex-shrink-0" style={{ color: '#54130E' }} />
      <h3 className="font-display text-base uppercase tracking-wider text-[#441514]">
        Statistika pataisyta
      </h3>
    </div>
    <p className="text-sm text-[#845641] mb-4 whitespace-pre-line leading-relaxed">
      {`Buvo klaida — kolegoms be administratoriaus teisių bendra įskaita rodė visus 0 taškų.\n\n`}
      {`Tavo taškai NIEKUR nedingo ir negalėjo dingti. Sistema kiekvieną kartą juos skaičiuoja iš išsaugotų prognozių ir oficialių rezultatų — abu šie duomenys visą laiką liko nepaliesti.\n\n`}
      {`Dabar statistika vėl rodo realią suvestinę. Atsiprašau už nepatogumus.`}
    </p>
    <button
      onClick={onDismiss}
      style={{ backgroundColor: '#54130E', color: '#ffffff' }}
      className="w-full py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all hover:opacity-90">
      Supratau
    </button>
  </ModalOverlay>
);

// useDialog hook - grąžina async `confirm`/`alert` funkcijas ir JSX dialog'ą.
// Naudoti vietoj native window.confirm/alert, kad UI atitiktų app dizainą.
function useDialog() {
  const [state, setState] = useState(null);

  const open = (config) => new Promise((resolve) => {
    setState({ ...config, resolve });
  });

  const confirm = (config) => open({ ...config, kind: 'confirm' });
  const notify = (config) => open({ ...config, kind: 'alert' });

  const close = (result) => {
    if (state?.resolve) state.resolve(result);
    setState(null);
  };

  const dialog = state ? (
    <ModalOverlay onClose={() => state.kind === 'confirm' ? close(false) : close(true)}>
      <h3 className="font-display text-base uppercase tracking-wider text-[#441514] mb-2">
        {state.title}
      </h3>
      {state.message && (
        <p className="text-sm text-[#845641] mb-4 whitespace-pre-line">{state.message}</p>
      )}
      {state.kind === 'confirm' ? (
        <div className="flex gap-2">
          <button
            onClick={() => close(false)}
            style={{ backgroundColor: '#ffffff', color: '#845641', border: '1px solid rgba(68, 21, 20, 0.2)' }}
            className="flex-1 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-[#441514]/5 transition-all">
            {state.cancelLabel || 'Atšaukti'}
          </button>
          <button
            onClick={() => close(true)}
            style={{ backgroundColor: state.variant === 'danger' ? '#6A1107' : '#54130E', color: '#ffffff' }}
            className="flex-1 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all hover:opacity-90">
            {state.confirmLabel || 'Patvirtinti'}
          </button>
        </div>
      ) : (
        <button
          onClick={() => close(true)}
          style={{ backgroundColor: state.variant === 'danger' ? '#6A1107' : '#54130E', color: '#ffffff' }}
          className="w-full py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all hover:opacity-90">
          Gerai
        </button>
      )}
    </ModalOverlay>
  ) : null;

  return { confirm, notify, dialog };
}

// ============================================================
// AUTH SCREENS
// ============================================================

const LoadingScreen = () => (
  <div className="app-bg font-body flex items-center justify-center min-h-screen">
    <Styles />
    <div className="flex flex-col items-center gap-3">
      <Loader2 className="w-8 h-8 text-[#54130E] animate-spin" />
      <p className="text-sm text-[#845641] uppercase tracking-widest">Kraunama...</p>
    </div>
  </div>
);

const LoginScreen = ({ onSwitchToRegister }) => {
  const [mode, setMode] = useState('login'); // 'login' | 'reset' | 'reset-sent'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Užpildyk visus laukus');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await loginUser(email, password);
      // onAuthChange auto-pakeis ekraną
    } catch (err) {
      setError(translateAuthError(err.code) || err.message);
      setLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!email) {
      setError('Įvesk el. paštą, į kurį siųsime instrukcijas');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await requestPasswordReset(email);
      setMode('reset-sent');
    } catch (err) {
      // Anti-enumeration: nesakome, ar el. paštas registruotas.
      // Net jei Firebase grąžina 'auth/user-not-found' - rodom tą patį pranešimą.
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-email') {
        setMode('reset-sent');
      } else if (err.code === 'auth/too-many-requests') {
        setError('Per daug bandymų. Palauk kelias minutes.');
      } else {
        setError(translateAuthError(err.code) || err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const switchToReset = () => {
    setMode('reset');
    setError('');
    setPassword('');
  };

  const switchToLogin = () => {
    setMode('login');
    setError('');
  };

  return (
    <div className="app-bg font-body text-[#441514] min-h-screen flex items-center justify-center p-4">
      <Styles />
      <div className="max-w-md w-full">
        <div className="relative overflow-hidden rounded-2xl p-6 paper-grain mb-4"
          style={{ background: 'linear-gradient(135deg, #9A6B52 0%, #845641 50%, #5C3E2E 100%)', color: '#FFFFFF' }}>
          {/* Full VMG logotipas - su W mark + VMG tekstu. Stipriai kontrastingas su STEM brown fonu */}
          <div className="flex justify-center mb-4">
            <Emblem className="w-36 h-32 lg:w-40 lg:h-36" variant="dark" full />
          </div>
          <h1 className="font-display text-center text-xl leading-tight">
            PASAULIO FUTBOLO<br/>ČEMPIONATAS
          </h1>
          <div className="flex items-center justify-center gap-3 my-3">
            <div className="h-px w-12" style={{ background: 'rgba(209, 169, 116, 0.8)' }}/>
            <span className="font-display text-base" style={{ color: '#D1A974', letterSpacing: '2px' }}>2026</span>
            <div className="h-px w-12" style={{ background: 'rgba(209, 169, 116, 0.8)' }}/>
          </div>
          <p className="font-display text-center text-sm tracking-widest opacity-90">TOTALIZATORIUS</p>
          {/* Slogan - viena eilutė */}
          <p className="text-[10px] uppercase tracking-widest opacity-80 mt-3 text-center">
            Įrodyk, kas čia futbolo ekspertas
          </p>
          {/* Datos - atskira eilutė po slogan'u */}
          <p className="font-mono text-[11px] mt-1.5 text-center" style={{ color: '#D1A974' }}>
            BIRŽ. 11 — LIEP. 19
          </p>
        </div>

        <div className="card-light rounded-2xl p-5">
          {/* === PRISIJUNGIMO REŽIMAS === */}
          {mode === 'login' && (
            <>
              <h2 className="font-display text-lg uppercase tracking-wider text-[#441514] mb-4">Prisijungimas</h2>

              <ErrorAlert message={error} />

              <div className="space-y-3">
                <FormField label="El. paštas" type="email" placeholder="vardas@paštas.lt"
                  value={email} onChange={setEmail} autoComplete="email" />
                <FormField label="Slaptažodis" type="password" placeholder="••••••••"
                  value={password} onChange={setPassword} autoComplete="current-password" />
              </div>

              {/* Slaptažodžio pamiršai nuoroda */}
              <div className="mt-2 text-right">
                <button type="button" onClick={switchToReset} disabled={loading}
                  className="text-[11px] font-semibold text-[#6A1107] hover:text-[#441514] underline-offset-2 hover:underline transition-colors disabled:opacity-50">
                  Pamiršai slaptažodį?
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-4">
                <button onClick={handleLogin} disabled={loading}
                  style={{ background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)', color: '#ffffff' }}
                  className="py-3 rounded-xl font-display uppercase tracking-wider shadow-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all duration-200 hover:scale-[1.02] hover:shadow-xl hover:brightness-110 active:scale-[0.98]">
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Prisijungti
                </button>
                <button onClick={onSwitchToRegister} disabled={loading}
                  style={{ backgroundColor: '#ffffff', color: '#6A1107', border: '2px solid #6A1107' }}
                  className="py-3 rounded-xl font-display uppercase tracking-wider text-sm disabled:opacity-50 transition-all duration-200 hover:bg-[#FAF0E0] hover:scale-[1.02]">
                  Registruotis
                </button>
              </div>
            </>
          )}

          {/* === SLAPTAŽODŽIO ATSTATYMO FORMA === */}
          {mode === 'reset' && (
            <>
              <h2 className="font-display text-lg uppercase tracking-wider text-[#441514] mb-1">Atstatyti slaptažodį</h2>
              <p className="text-xs text-[#845641] mb-4">
                Įvesk savo el. paštą — gausi nuorodą slaptažodžio atstatymui.
              </p>

              <ErrorAlert message={error} />

              <div className="space-y-3">
                <FormField label="El. paštas" type="email" placeholder="vardas@paštas.lt"
                  value={email} onChange={setEmail} autoComplete="email" />
              </div>

              <div className="grid grid-cols-2 gap-2 mt-5">
                <button onClick={switchToLogin} disabled={loading}
                  style={{ backgroundColor: '#ffffff', color: '#845641', border: '2px solid #845641' }}
                  className="py-3 rounded-xl font-display uppercase tracking-wider text-sm disabled:opacity-50 transition-all duration-200 hover:bg-[#FAF0E0] hover:scale-[1.02]">
                  Atgal
                </button>
                <button onClick={handlePasswordReset} disabled={loading}
                  style={{ background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)', color: '#ffffff' }}
                  className="py-3 rounded-xl font-display uppercase tracking-wider shadow-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all duration-200 hover:scale-[1.02] hover:shadow-xl hover:brightness-110 active:scale-[0.98]">
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Siųsti
                </button>
              </div>
            </>
          )}

          {/* === ATSTATYMO LAIŠKAS IŠSIŲSTAS - PATVIRTINIMAS === */}
          {mode === 'reset-sent' && (
            <>
              <h2 className="font-display text-lg uppercase tracking-wider text-[#441514] mb-3">Patikrink el. paštą</h2>
              <div className="rounded-lg p-3 mb-4" style={{ backgroundColor: '#FAF0E0', border: '1px solid rgba(132, 86, 65, 0.3)' }}>
                <p className="text-sm text-[#441514] leading-relaxed">
                  Jei <span className="font-mono font-bold text-[#6A1107]">{email}</span> egzistuoja sistemoje, atsiųsime nuorodą slaptažodžio atstatymui.
                </p>
              </div>
              <p className="text-[11px] text-[#845641] mb-4 leading-relaxed">
                Jei per 5 min. nieko negausi:
              </p>
              <ul className="text-[11px] text-[#845641] mb-5 space-y-1 leading-relaxed list-disc list-inside">
                <li>Patikrink Spam / Šiukšlių aplanką</li>
                <li>Patikrink, ar el. paštas teisingai įvestas</li>
                <li>Pabandyk dar kartą po keliolikos minučių</li>
              </ul>
              <button onClick={switchToLogin}
                style={{ background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)', color: '#ffffff' }}
                className="w-full py-3 rounded-xl font-display uppercase tracking-wider shadow-lg text-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-xl hover:brightness-110 active:scale-[0.98]">
                Grįžti į prisijungimą
              </button>
            </>
          )}
        </div>

        <div className="flex items-center justify-center gap-1.5 mt-4 text-[10px] text-[#845641] uppercase tracking-widest">
          <Lock className="w-3 h-3" /> Saugu · Šifruota · Privatu
        </div>
      </div>
    </div>
  );
};

const RegisterScreen = ({ onSwitchToLogin, companies = [] }) => {
  const { notify, dialog } = useDialog();
  const [form, setForm] = useState({ username: '', fullName: '', email: '', password: '', companyChoice: '' });
  const [agreedToPolicy, setAgreedToPolicy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const updateField = (field) => (value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // Privatumo politikos modal - condensed versija
  const showPrivacyPolicy = () => {
    notify({
      title: 'Privatumo politika',
      message:
        'Šis totalizatorius yra vidinis VMG projektas.\n\n' +
        'DUOMENŲ VALDYTOJAS:\n' +
        'Paulius Barzdonis · paulius.barzdonis@mediena.lt\n\n' +
        'KOKIE DUOMENYS RENKAMI:\n' +
        '• El. paštas, slaptažodis (bcrypt hash) - prisijungimui\n' +
        '• Vardas/pavardė - tik tau ir admin\'ui\n' +
        '• Vartotojo vardas, įmonė, prognozės - kitiems matomi\n' +
        '• Naršyklės elgesio signalai (Google reCAPTCHA) - botų apsauga\n\n' +
        'TREČIOSIOS ŠALYS:\n' +
        '• Google Firebase (autentifikacija + DB, ES datacenter\'iai, GDPR-compliant DPA)\n' +
        '• Netlify (kodo hosting\'as, jokių PII)\n' +
        '• Google reCAPTCHA + Fonts\n\n' +
        'TAVO TEISĖS (GDPR):\n' +
        '• Prieiti, taisyti, ištrinti savo duomenis (Profile ekrane)\n\n' +
        'SAUGOJIMAS:\n' +
        'Iki turnyro pabaigos + 30 dienų. Tada PII anonimizuojama.\n\n' +
        'Pilną politiką rasi Taisyklių skiltyje po prisijungimo.',
    });
  };

  const handleRegister = async () => {
    if (!form.username || !form.fullName || !form.email || !form.password) {
      setError('Užpildyk visus laukus');
      return;
    }
    if (!form.companyChoice) {
      setError('Pasirink savo įmonę');
      return;
    }
    if (!agreedToPolicy) {
      setError('Patvirtinai, kad sutinki su Taisyklėmis ir Privatumo politika');
      return;
    }
    if (form.password.length < 8) {
      setError('Slaptažodis turi būti bent 8 simboliai');
      return;
    }
    if (!/[a-zA-Z]/.test(form.password)) {
      setError('Slaptažodyje turi būti bent viena raidė');
      return;
    }
    if (!/\d/.test(form.password)) {
      setError('Slaptažodyje turi būti bent vienas skaičius');
      return;
    }
    if (form.username.length < 3) {
      setError('Vartotojo vardas turi būti bent 3 simboliai');
      return;
    }
    setError('');
    setLoading(true);
    try {
      // companyChoice = company.id - visi vartotojai turi priklausyti įmonei
      const company = companies.find((c) => c.id === form.companyChoice);
      if (!company) {
        setError('Pasirinkta įmonė nerasta');
        setLoading(false);
        return;
      }
      const companyId = company.id;
      const companyName = company.name;
      const companyCode = company.code || null;
      await registerUser(form.email, form.password, form.username, form.fullName, companyId, companyName, companyCode);
      // onAuthChange auto-pakeis ekraną
    } catch (err) {
      setError(translateAuthError(err.code) || err.message);
      setLoading(false);
    }
  };

  return (
    <div className="app-bg font-body text-[#441514] min-h-screen flex items-center justify-center p-4">
      <Styles />
      <div className="max-w-md w-full">
        {/* Atgal mygtukas su slide animacija */}
        <button onClick={onSwitchToLogin} disabled={loading}
          className="text-[#845641] hover:text-[#441514] flex items-center gap-1 mb-3 text-sm font-semibold disabled:opacity-50 transition-all duration-200 hover:-translate-x-1 group">
          <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" /> Atgal
        </button>

        {/* Gradient border wrapper - kortelė su VMG brand spalvomis */}
        <div className="relative rounded-2xl p-[1.5px] shadow-xl transition-shadow duration-300 hover:shadow-2xl"
          style={{ background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 40%, #D1A974 100%)' }}>
          <div className="bg-white rounded-2xl p-6">
            {/* Header - kamuolio ikona dėžutėje su gradient'u + gradient text */}
            <div className="flex items-center gap-3 mb-2">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shadow-md transition-transform duration-200 hover:scale-110 hover:rotate-6"
                style={{ background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)' }}>
                <FootballIcon className="w-6 h-6 text-[#D1A974]" />
              </div>
              <h2 className="font-display text-xl uppercase tracking-wider"
                style={{
                  background: 'linear-gradient(135deg, #54130E 0%, #6A1107 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}>
                Registracija
              </h2>
            </div>
            <p className="text-sm text-[#845641] mb-5 italic">
              Pradėk spėlioti ir parodyk, kad esi geriausias
            </p>

            <ErrorAlert message={error} />

            <div className="space-y-3">
              <FormField label="Vartotojo vardas" placeholder="pvz., sportasluve"
                value={form.username} onChange={updateField('username')} autoComplete="username" />
              <FormField label="Vardas Pavardė" placeholder="pvz., Vardenis Pavardenis"
                value={form.fullName} onChange={updateField('fullName')} autoComplete="name" />
              <FormField label="El. paštas" type="email" placeholder="vardas@imone.lt"
                value={form.email} onChange={updateField('email')} autoComplete="email" />
              <FormField label="Slaptažodis" type="password" placeholder="Bent 8 simb. (raidė + skaičius)"
                value={form.password} onChange={updateField('password')} autoComplete="new-password" />

              {/* Įmonės dropdown su tokiu pat hover/focus style kaip FormField */}
              <div>
                <label className="block text-[10px] font-bold text-[#845641] uppercase tracking-wider mb-1.5">Įmonė</label>
                <select
                  value={form.companyChoice}
                  onChange={(e) => updateField('companyChoice')(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg bg-white border border-[#441514]/15 text-sm text-[#441514] focus:outline-none focus:border-[#54130E] focus:ring-2 focus:ring-[#54130E]/15 hover:border-[#845641]/30 transition-all font-medium disabled:opacity-50"
                  disabled={loading}>
                  <option value="" disabled>-- Pasirinkti įmonę --</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code ? `${c.code} — ${c.name}` : c.name}
                    </option>
                  ))}
                </select>
                {companies.length === 0 && (
                  <p className="text-[10px] text-[#6A1107] mt-1 font-semibold">
                    Įmonių sąrašas tuščias. Palauk, kol administratorius pridės — be įmonės registruotis negalima.
                  </p>
                )}
              </div>
            </div>

            {/* Sutikimo checkbox - GDPR consent */}
            <div className="mt-4 flex items-start gap-2.5 rounded-lg p-3 bg-[#D1A974]/8 border border-[#D1A974]/30">
              <input
                type="checkbox"
                id="privacy-consent"
                checked={agreedToPolicy}
                onChange={(e) => setAgreedToPolicy(e.target.checked)}
                disabled={loading}
                className="mt-0.5 w-4 h-4 cursor-pointer accent-[#6A1107] flex-shrink-0"
              />
              <label htmlFor="privacy-consent" className="text-[11px] text-[#441514] leading-relaxed cursor-pointer">
                Patvirtinau, kad susipažinau ir sutinku su{' '}
                <button type="button" onClick={showPrivacyPolicy}
                  className="text-[#6A1107] font-bold underline underline-offset-2 hover:text-[#441514] transition-colors">
                  Privatumo politika
                </button>
                {' '}— suprantu, kokie duomenys renkami ir kaip jie tvarkomi.
              </label>
            </div>

            {/* Submit mygtukas su gradient + scale hover + shadow grow */}
            <button onClick={handleRegister} disabled={loading || !agreedToPolicy}
              style={{ background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)' }}
              className="w-full py-3.5 rounded-xl font-display uppercase tracking-wider text-white shadow-lg text-sm mt-4 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all duration-200 hover:scale-[1.02] hover:shadow-2xl hover:brightness-110 active:scale-[0.98]">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Sukurti paskyrą
            </button>
          </div>
        </div>

        <p className="text-xs text-center text-[#845641] mt-4">
          Jau turi paskyrą?{' '}
          <button onClick={onSwitchToLogin}
            className="text-[#54130E] font-bold hover:underline hover:text-[#6A1107] transition-colors">
            Prisijungti
          </button>
        </p>
      </div>
      {dialog}
    </div>
  );
};

// ============================================================
// APP SCREENS
// ============================================================

const HomeScreen = ({ userProfile, usersWithPoints, matches, predictions, setScreen, onUpdatePrediction }) => {
  const [lbTab, setLbTab] = useState('all'); // 'all' | 'companies' | 'mine'

  const sortedUsers = useMemo(
    () => [...usersWithPoints].sort((a, b) => b.points - a.points),
    [usersWithPoints]
  );
  const me = sortedUsers.find((u) => u.uid === userProfile.uid) || userProfile;
  const myRank = sortedUsers.findIndex((u) => u.uid === userProfile.uid) + 1;

  // Mano įmonės dalyviai + mano vieta jose
  const myCompanyUsers = useMemo(() => {
    if (!userProfile.companyId) return [];
    return sortedUsers.filter((u) => u.companyId === userProfile.companyId);
  }, [sortedUsers, userProfile.companyId]);
  const myCompanyRank = myCompanyUsers.findIndex((u) => u.uid === userProfile.uid) + 1;

  // Įmonių statistika (vidurkis vienam dalyviui)
  const companyStats = useMemo(() => {
    const stats = {};
    sortedUsers.forEach((u) => {
      if (!u.companyId) return;
      if (!stats[u.companyId]) {
        stats[u.companyId] = {
          companyId: u.companyId,
          companyName: u.companyName || 'Nežinoma',
          companyCode: u.companyCode || null,
          memberCount: 0,
          totalPoints: 0,
        };
      }
      stats[u.companyId].memberCount++;
      stats[u.companyId].totalPoints += u.points || 0;
    });
    return Object.values(stats)
      .map((s) => ({ ...s, avgPoints: s.memberCount > 0 ? s.totalPoints / s.memberCount : 0 }))
      .sort((a, b) => b.avgPoints - a.avgPoints);
  }, [sortedUsers]);

  const upcomingMatches = matches.filter((m) => m.status === 'upcoming').slice(0, 6);
  const liveMatches = matches.filter((m) => m.status === 'live');

  const upcomingSection = upcomingMatches.length > 0 && (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[#54130E]" />
          <h2 className="font-display text-sm uppercase tracking-wider text-[#441514]">Artimiausios</h2>
        </div>
        <button onClick={() => setScreen('matches')}
          className="text-[10px] font-bold text-[#54130E] uppercase tracking-wider flex items-center gap-1">
          Visos <ChevronRight className="w-3 h-3" />
        </button>
      </div>
      <div className="space-y-3">
        {upcomingMatches.map((m) => (
          <MatchCard key={m.id} match={m} prediction={predictions[m.id]} onUpdatePrediction={onUpdatePrediction} />
        ))}
      </div>
    </div>
  );

  // Lyderlentės sekcija - 3 tabs (Bendra / Įmonės / Mano įmonė)
  const lbTabs = [
    { id: 'all', label: 'Bendra' },
    { id: 'companies', label: 'Įmonės' },
    { id: 'mine', label: 'Mano įmonė', disabled: !userProfile.companyId },
  ];

  const renderUserRow = (u, i) => {
    const isMe = u.uid === userProfile.uid;
    return (
      <div key={u.uid}
        className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${isMe ? 'bg-[#54130E]/8' : 'hover:bg-[#441514]/5'}`}>
        <div className="font-display text-xl w-6 text-center"
          style={{ color: i === 0 ? '#D1A974' : i === 1 ? '#A88A6F' : i === 2 ? '#845641' : '#A88A6F' }}>
          {i + 1}
        </div>
        <div className="w-8 h-8 rounded-full flex items-center justify-center font-display text-sm flex-shrink-0"
          style={{ backgroundColor: `${u.avatarColor}20`, color: u.avatarColor }}>
          {u.avatarLetter}
        </div>
        <div className="flex-1 text-sm font-semibold text-[#441514] truncate">
          {u.username}{isMe && <span className="text-[10px] ml-1 opacity-70">(tu)</span>}
        </div>
        <div className="font-mono font-bold text-[#54130E]">{u.points}</div>
      </div>
    );
  };

  const renderCompanyRow = (c, i) => {
    const abbrev = companyAbbreviation({ name: c.companyName, code: c.companyCode });
    return (
      <div key={c.companyId}
        className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${c.companyId === userProfile.companyId ? 'bg-[#54130E]/8' : 'hover:bg-[#441514]/5'}`}>
        <div className="font-display text-xl w-6 text-center"
          style={{ color: i === 0 ? '#D1A974' : i === 1 ? '#A88A6F' : i === 2 ? '#845641' : '#A88A6F' }}>
          {i + 1}
        </div>
        <div className="min-w-[40px] h-8 px-2 rounded-lg flex items-center justify-center font-display font-mono text-xs bg-[#54130E]/10 text-[#54130E] flex-shrink-0">
          {abbrev}
        </div>
        <div className="flex-1 text-sm font-semibold text-[#441514] truncate">
          {c.companyName}
        </div>
        <div className="font-mono font-bold text-[#54130E]">{c.avgPoints.toFixed(1)}</div>
      </div>
    );
  };

  const leaderboardSection = sortedUsers.length > 0 && (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Crown className="w-4 h-4 text-[#D1A974]" />
        <h2 className="font-display text-sm uppercase tracking-wider text-[#441514]">Lyderiai</h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-[#441514]/5 mb-2">
        {lbTabs.map((t) => (
          <button key={t.id}
            onClick={() => !t.disabled && setLbTab(t.id)}
            disabled={t.disabled}
            style={lbTab === t.id ? { backgroundColor: '#FFFFFF', color: '#441514' } : { color: '#845641' }}
            className="flex-1 py-1.5 px-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed">
            {t.label}
          </button>
        ))}
      </div>

      <div className="card-light rounded-xl p-2">
        {lbTab === 'all' && sortedUsers.slice(0, 5).map((u, i) => renderUserRow(u, i))}
        {lbTab === 'companies' && (
          companyStats.length > 0
            ? companyStats.slice(0, 5).map((c, i) => renderCompanyRow(c, i))
            : <p className="text-xs text-[#845641] text-center py-3">Įmonių dar nėra</p>
        )}
        {lbTab === 'mine' && (
          myCompanyUsers.length > 0
            ? myCompanyUsers.slice(0, 5).map((u, i) => renderUserRow(u, i))
            : <p className="text-xs text-[#845641] text-center py-3">Tu nepriklausai įmonei</p>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4 pb-24 lg:pb-8">
      <div className="relative overflow-hidden rounded-2xl p-5 lg:p-7 paper-grain"
        style={{ background: 'linear-gradient(135deg, #9A6B52 0%, #845641 50%, #5C3E2E 100%)', color: '#FFFFFF' }}>
        <div className="flex items-start gap-4 mb-4">
          <Emblem className="w-16 h-16 lg:w-20 lg:h-20 flex-shrink-0" variant="dark" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest mb-1 opacity-70">
              Sveikas, {userProfile.username}
            </div>
            <h1 className="font-display text-base lg:text-xl leading-tight">
              PASAULIO FUTBOLO<br/>ČEMPIONATAS 2026
            </h1>
            <div className="text-[10px] uppercase tracking-widest opacity-60 mt-1" style={{ color: '#D1A974' }}>
              Totalizatorius
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-white/15">
          <div>
            <div className="text-[10px] uppercase tracking-wider mb-1 opacity-60">Taškai</div>
            <div className="font-display text-2xl lg:text-3xl">{me.points || 0}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider mb-1 opacity-60">Vieta</div>
            <div className="font-display text-2xl lg:text-3xl">#{myRank || '-'}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider mb-1 opacity-60">Įmonėje</div>
            <div className="font-display text-2xl lg:text-3xl">
              {myCompanyRank > 0 ? `#${myCompanyRank}` : '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider mb-1 opacity-60">Serija</div>
            <div className="font-display text-2xl lg:text-3xl flex items-center gap-1" style={{ color: '#D1A974' }}>
              {me.streak || 0} <Flame className="w-5 h-5 lg:w-6 lg:h-6" />
            </div>
          </div>
        </div>
      </div>

      {liveMatches.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Radio className="w-4 h-4 text-[#6A1107] pulse-live" />
            <h2 className="font-display text-sm uppercase tracking-wider text-[#441514]">Vyksta dabar</h2>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {liveMatches.map((m) => (
              <MatchCard key={m.id} match={m} prediction={predictions[m.id]} onUpdatePrediction={onUpdatePrediction} />
            ))}
          </div>
        </div>
      )}

      {matches.length === 0 && (
        <div className="card-light rounded-xl p-5 text-center">
          <AlertCircle className="w-8 h-8 text-[#D1A974] mx-auto mb-2" />
          <p className="text-sm text-[#441514] font-semibold mb-1">Dar nėra įvestų rungtynių</p>
          <p className="text-xs text-[#845641]">Administratorius dar nesuvedė rungtynių sąrašo.</p>
        </div>
      )}

      {/* Desktop: upcoming kairėje, leaderboard dešinėje. Mobile: stack vertically. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:items-start">
        <div className="lg:col-span-2">{upcomingSection}</div>
        <div>{leaderboardSection}</div>
      </div>
    </div>
  );
};

const MatchesScreen = ({ matches, predictions, onUpdatePrediction }) => {
  const [filter, setFilter] = useState('all');

  const filteredMatches = useMemo(() => {
    let base;
    if (filter === 'all') base = matches;
    else if (filter === 'upcoming') base = matches.filter((m) => m.status === 'upcoming');
    else if (filter === 'finished') base = matches.filter((m) => m.status === 'finished');
    else if (filter === 'knockout') base = matches.filter((m) => m.stage && m.stage !== 'group');
    else base = matches.filter((m) => m.group === filter);

    // Smart rūšiavimas (ypač "Visos" filtrui telefone, kad pradžioje matytųsi
    // tai, kas dabar aktualu, o ne pati pirmoji turnyro rungtynė):
    //   1) Live (vyksta dabar) — viršuje
    //   2) Upcoming — chronologiškai (artimiausia pirmiausia)
    //   3) Finished — atvirkščiai chronologiškai (naujausi rezultatai pirmiausia)
    // "Baigtos" filtre tas pats principas — naujausi pirmiausia.
    // Kituose filtruose (Būsimos, grupės A-L, Atkrintamosios) status'ai sumaišyti
    // retai — efektyviai gausis chronologinis. Jei visų vienodas status — sorting
    // viduje vis tiek tvarkingas.
    const asc = (a, b) => (a.kickoff || '').localeCompare(b.kickoff || '');
    const desc = (a, b) => (b.kickoff || '').localeCompare(a.kickoff || '');
    const live = base.filter((m) => m.status === 'live').sort(asc);
    const upcoming = base.filter((m) => m.status === 'upcoming').sort(asc);
    const finished = base.filter((m) => m.status === 'finished').sort(desc);
    return [...live, ...upcoming, ...finished];
  }, [filter, matches]);

  return (
    <div className="space-y-4 pb-24 lg:pb-8">
      <div>
        <h1 className="font-display text-3xl lg:text-4xl text-[#441514] mb-1">RUNGTYNĖS</h1>
        <p className="text-sm text-[#845641]">Spėk rezultatą iki rungtynių pradžios</p>
      </div>

      <div className="flex gap-2 overflow-x-auto lg:flex-wrap lg:overflow-visible scrollbar-hide -mx-1 px-1">
        {[
          { id: 'all', label: 'Visos' },
          { id: 'upcoming', label: 'Būsimos' },
          { id: 'finished', label: 'Baigtos' },
          { id: 'knockout', label: 'Atkrintamosios' },
          { id: 'A', label: 'A' }, { id: 'B', label: 'B' }, { id: 'C', label: 'C' },
          { id: 'D', label: 'D' }, { id: 'E', label: 'E' }, { id: 'F', label: 'F' },
          { id: 'G', label: 'G' }, { id: 'H', label: 'H' }, { id: 'I', label: 'I' },
          { id: 'J', label: 'J' }, { id: 'K', label: 'K' }, { id: 'L', label: 'L' },
        ].map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
              filter === f.id ? 'bg-[#54130E] text-white' : 'bg-white text-[#845641] border border-[#441514]/10 hover:text-[#441514]'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {filteredMatches.length === 0 ? (
        <div className="card-light rounded-xl p-5 text-center">
          <p className="text-sm text-[#845641]">Nėra rungtynių pagal pasirinktą filtrą</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredMatches.map((m) => (
            <MatchCard key={m.id} match={m} prediction={predictions[m.id]} onUpdatePrediction={onUpdatePrediction} />
          ))}
        </div>
      )}
    </div>
  );
};

const TournamentScreen = ({ userProfile, matches, tournamentBet, setTournamentBet }) => {
  const { notify, dialog } = useDialog();
  // Lokalus state redagavimui (atskiras nuo tournamentBet)
  const [local, setLocal] = useState({
    champion: tournamentBet?.champion || '',
    bestPlayer: tournamentBet?.bestPlayer || '',
    topScorer: tournamentBet?.topScorer || '',
    bestGoalkeeper: tournamentBet?.bestGoalkeeper || '',
    bestYoungPlayer: tournamentBet?.bestYoungPlayer || '',
  });
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Ar yra išsaugotų prognozių?
  const hasSavedPrediction = Boolean(
    tournamentBet?.champion || tournamentBet?.bestPlayer ||
    tournamentBet?.topScorer || tournamentBet?.bestGoalkeeper ||
    tournamentBet?.bestYoungPlayer
  );

  const [isEditing, setIsEditing] = useState(!hasSavedPrediction);

  // Užšaldymas pagal turnyro pradžios timestamp - suderinta su firestore.rules server-side lock'u.
  // Admin gali laisvai testuoti rungtynių statusus, neužšaldant tournament bet'ų visiems.
  const isLocked = useMemo(
    () => Date.now() >= TOURNAMENT_LOCK_TIME,
    [matches] // re-eval kai matches atsinaujina (dažnai), nors deps čia tik trigger
  );

  // Ankstyviausios "upcoming" rungtynės countdown'ui
  const firstUpcoming = useMemo(() => {
    return [...matches]
      .filter((m) => m.status === 'upcoming')
      .sort((a, b) => (a.kickoff || '').localeCompare(b.kickoff || ''))[0];
  }, [matches]);

  // Visos dalyvaujančios šalys - sąjunga iš matches ir teamsByCode
  const allCountries = useMemo(() => {
    const codes = new Set();
    matches.forEach((m) => {
      if (m.home) codes.add(m.home);
      if (m.away) codes.add(m.away);
    });
    Object.keys(teamsByCode).forEach((c) => codes.add(c));
    return Array.from(codes)
      .filter((c) => teamsByCode[c]) // tik tos, kurioms turime pavadinimą/vėliavą
      .sort((a, b) => (teamsByCode[a]?.name || '').localeCompare(teamsByCode[b]?.name || '', 'lt'));
  }, [matches]);

  // Sinchronizuoti lokalų state kai tournamentBet pasikeičia iš išorės
  useEffect(() => {
    if (tournamentBet) {
      setLocal({
        champion: tournamentBet.champion || '',
        bestPlayer: tournamentBet.bestPlayer || '',
        topScorer: tournamentBet.topScorer || '',
        bestGoalkeeper: tournamentBet.bestGoalkeeper || '',
        bestYoungPlayer: tournamentBet.bestYoungPlayer || '',
      });
    }
  }, [tournamentBet?.champion, tournamentBet?.bestPlayer, tournamentBet?.topScorer,
      tournamentBet?.bestGoalkeeper, tournamentBet?.bestYoungPlayer]);

  // Ar yra neišsaugotų pakeitimų?
  const hasChanges = !hasSavedPrediction || (
    local.champion !== (tournamentBet?.champion || '') ||
    local.bestPlayer !== (tournamentBet?.bestPlayer || '') ||
    local.topScorer !== (tournamentBet?.topScorer || '') ||
    local.bestGoalkeeper !== (tournamentBet?.bestGoalkeeper || '') ||
    local.bestYoungPlayer !== (tournamentBet?.bestYoungPlayer || '')
  );

  // Bent vienas laukas užpildytas?
  const hasAnyValue = Boolean(
    local.champion || local.bestPlayer || local.topScorer ||
    local.bestGoalkeeper || local.bestYoungPlayer
  );

  const handleSave = async () => {
    if (isLocked || !hasChanges || saving || !hasAnyValue) return;
    setSaving(true);
    try {
      await saveTournamentBet(userProfile.uid, local);
      setTournamentBet({
        champion: local.champion || null,
        bestPlayer: local.bestPlayer,
        topScorer: local.topScorer,
        bestGoalkeeper: local.bestGoalkeeper,
        bestYoungPlayer: local.bestYoungPlayer,
      });
      setJustSaved(true);
      setIsEditing(false);
      setTimeout(() => setJustSaved(false), 2000);
    } catch (err) {
      console.error(err);
      await notify({ title: 'Nepavyko išsaugoti', message: err.message, variant: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setLocal({
      champion: tournamentBet?.champion || '',
      bestPlayer: tournamentBet?.bestPlayer || '',
      topScorer: tournamentBet?.topScorer || '',
      bestGoalkeeper: tournamentBet?.bestGoalkeeper || '',
      bestYoungPlayer: tournamentBet?.bestYoungPlayer || '',
    });
    setIsEditing(false);
  };

  // Input'ai blokuojami: kai užšaldyta ARBA saugoma ARBA view mode su išsaugotomis prognozėmis
  const inputsDisabled = isLocked || saving || (!isEditing && hasSavedPrediction);

  const tu = firstUpcoming ? timeUntil(firstUpcoming.kickoff) : null;

  // Žaidėjų prognozių laukai
  const playerFields = [
    { key: 'bestPlayer', label: 'Geriausias turnyro žaidėjas', icon: Trophy, points: 15, color: '#D1A974' },
    { key: 'topScorer', label: 'Daugiausiai įvarčių įmušęs žaidėjas', icon: Target, points: 15, color: '#54130E' },
    { key: 'bestGoalkeeper', label: 'Geriausias vartininkas', icon: Shield, points: 15, color: '#54130E' },
    { key: 'bestYoungPlayer', label: 'Geriausias 21m. ar jaunesnis žaidėjas', icon: Star, points: 15, color: '#6A1107' },
  ];

  return (
    <div className="space-y-4 pb-24 lg:pb-8">
      <div>
        <h1 className="font-display text-3xl lg:text-4xl text-[#441514] mb-1">ČEMPIONATO SPĖJIMAS</h1>
        <p className="text-sm text-[#845641]">
          {isLocked
            ? 'Prognozės užšaldytos · turnyras jau prasidėjęs'
            : `Prognozes galima keisti iki pirmųjų rungtynių${tu ? ` · liko ${tu}` : ''}`}
        </p>
      </div>

      {/* ČEMPIONAS */}
      <div className="card-light rounded-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Crown className="w-5 h-5 text-[#D1A974]" />
            <h3 className="font-display text-lg text-[#441514]">ČEMPIONAS</h3>
          </div>
          <span className="text-[10px] font-bold text-[#D1A974] uppercase tracking-wider">25 tšk.</span>
        </div>
        <p className="text-xs text-[#845641] mb-4">Pasirink turnyro nugalėtoją</p>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
          {allCountries.map((code) => (
            <TeamPickButton key={code} code={code}
              selected={local.champion === code}
              onClick={() => !inputsDisabled && setLocal({ ...local, champion: code })}
              accentColor="#D1A974"
              disabled={inputsDisabled} />
          ))}
        </div>
      </div>

      {/* ŽAIDĖJŲ PROGNOZĖS - desktop'e 2-col grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {playerFields.map(({ key, label, icon: Icon, points, color }) => (
        <div key={key} className="card-light rounded-2xl p-5">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Icon className="w-5 h-5" style={{ color }} />
              <h3 className="font-display text-sm text-[#441514] uppercase tracking-wider">{label}</h3>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ml-2" style={{ color }}>
              {points} tšk.
            </span>
          </div>
          <p className="text-xs text-[#845641] mb-3">Įrašyk žaidėjo vardą ir pavardę</p>
          <input type="text"
            placeholder="pvz., Lionel Messi"
            value={local[key]}
            onChange={(e) => setLocal({ ...local, [key]: e.target.value })}
            disabled={inputsDisabled}
            className="w-full px-4 py-3 rounded-lg bg-[#FFFFFF] border border-[#441514]/10 text-[#441514] placeholder-[#A88A6F] focus:outline-none focus:border-[#54130E]/50 font-medium disabled:opacity-60 disabled:cursor-not-allowed" />
        </div>
      ))}
      </div>

      {/* MYGTUKAI */}
      {isLocked ? (
        <div className="rounded-xl p-3 bg-[#441514]/5 border border-[#441514]/10 flex items-center gap-2">
          <Lock className="w-4 h-4 text-[#845641]" />
          <span className="text-xs text-[#845641]">Prognozės užšaldytos. Turnyras jau prasidėjęs.</span>
        </div>
      ) : !isEditing && hasSavedPrediction ? (
        // VIEW MODE
        <button onClick={() => setIsEditing(true)}
          style={{ backgroundColor: '#FAF0E0', color: '#54130E', border: '1px solid rgba(84, 19, 14, 0.2)' }}
          className="w-full py-3 rounded-xl text-xs font-bold uppercase tracking-wider hover:opacity-80 transition-all">
          Redaguoti prognozes
        </button>
      ) : (
        // EDIT MODE
        <div className="flex gap-2">
          {hasSavedPrediction && (
            <button onClick={handleCancel} disabled={saving}
              style={{ backgroundColor: '#ffffff', color: '#845641', border: '1px solid rgba(68, 21, 20, 0.2)' }}
              className="flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-wider disabled:opacity-50 hover:bg-[#441514]/5 transition-all">
              Atšaukti
            </button>
          )}
          <button onClick={handleSave} disabled={!hasChanges || saving || justSaved || !hasAnyValue}
            style={(!hasChanges || justSaved || !hasAnyValue) && !saving
              ? { backgroundColor: '#FAF0E0', color: '#845641' }
              : { background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)', color: '#ffffff' }}
            className={`${hasSavedPrediction ? 'flex-1' : 'w-full'} py-3 rounded-xl text-xs font-bold uppercase tracking-wider disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md transition-all duration-200 hover:scale-[1.02] hover:brightness-110 hover:shadow-lg active:scale-[0.98]`}>
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {justSaved && <CheckCircle2 className="w-4 h-4" />}
            {saving ? 'Saugoma...' : justSaved ? 'Išsaugota' : hasSavedPrediction ? 'Atnaujinti prognozes' : 'Patvirtinti prognozes'}
          </button>
        </div>
      )}

      {dialog}
    </div>
  );
};

const LeaderboardScreen = ({ usersWithPoints, userProfile }) => {
  const [tab, setTab] = useState('overall'); // 'overall' | 'company' | 'companies'
  const [showCompanySizes, setShowCompanySizes] = useState(false); // toggle apatinės sekcijos su įmonių dydžiais

  const sortedUsers = useMemo(
    () => [...usersWithPoints].sort((a, b) => b.points - a.points),
    [usersWithPoints]
  );

  // Mano įmonės dalyviai
  const myCompanyUsers = useMemo(() => {
    if (!userProfile.companyId) return [];
    return sortedUsers.filter((u) => u.companyId === userProfile.companyId);
  }, [sortedUsers, userProfile.companyId]);

  // Įmonių statistika (agreguotas vidurkis)
  const companyStats = useMemo(() => {
    const stats = {};
    sortedUsers.forEach((u) => {
      if (!u.companyId) return; // praleisti "Be įmonės" vartotojus
      if (!stats[u.companyId]) {
        stats[u.companyId] = {
          companyId: u.companyId,
          companyName: u.companyName || 'Nežinoma įmonė',
          companyCode: u.companyCode || null,
          members: [],
          totalPoints: 0,
        };
      }
      stats[u.companyId].members.push(u);
      stats[u.companyId].totalPoints += u.points || 0;
    });
    const arr = Object.values(stats).map((s) => ({
      ...s,
      memberCount: s.members.length,
      avgPoints: s.members.length > 0 ? s.totalPoints / s.members.length : 0,
    }));
    // Rūšiavimas: pagal vidurkį vienam dalyviui (sąžiningas mažoms ir didelėms įmonėms)
    arr.sort((a, b) => b.avgPoints - a.avgPoints);
    return arr;
  }, [sortedUsers]);

  // Atskira rūšiuota kopija pagal dalyvių sk. - rodoma kai paspaudžiama "Didžiausia" kortelė
  const companiesBySize = useMemo(
    () => [...companyStats].sort((a, b) => b.memberCount - a.memberCount || b.avgPoints - a.avgPoints),
    [companyStats]
  );

  const tabs = [
    { id: 'overall', label: 'Bendra' },
    { id: 'company', label: 'Mano įmonė' },
    { id: 'companies', label: 'Įmonės' },
  ];

  if (sortedUsers.length === 0) {
    return (
      <div className="card-light rounded-xl p-6 text-center pb-24">
        <p className="text-sm text-[#845641]">Dar nėra dalyvių</p>
      </div>
    );
  }

  const renderUserRow = (u, i, isMe) => (
    <div key={u.uid}
      className={`flex items-center gap-3 p-3 border-b border-[#441514]/8 last:border-0 ${isMe ? 'bg-[#54130E]/5' : ''}`}>
      <div className="font-display text-sm w-6 text-center text-[#845641]">{i + 1}</div>
      <div className="w-9 h-9 rounded-full flex items-center justify-center font-display text-sm"
        style={{ backgroundColor: `${u.avatarColor}20`, color: u.avatarColor }}>
        {u.avatarLetter}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-semibold truncate ${isMe ? 'text-[#54130E]' : 'text-[#441514]'}`}>
          {u.username} {isMe && <span className="text-[10px] ml-1 opacity-70">(tu)</span>}
        </div>
        <div className="text-[10px] text-[#845641] flex items-center gap-2 truncate">
          {u.companyName ? (
            <span className="truncate">{u.companyName}</span>
          ) : (
            <span className="opacity-60">Be įmonės</span>
          )}
          <span className="flex items-center gap-0.5"><Flame className="w-2.5 h-2.5" />{u.streak || 0}</span>
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono font-bold text-[#54130E]">{u.points}</div>
        <div className="text-[9px] text-[#845641] uppercase tracking-wider">tšk.</div>
      </div>
    </div>
  );

  const renderPodium = (users) => {
    if (users.length < 3) return null;
    return (
      <div className="grid grid-cols-3 gap-2 items-end">
        {[users[1], users[0], users[2]].map((u, idx) => {
          const realIdx = idx === 0 ? 1 : idx === 1 ? 0 : 2;
          const heights = ['h-20', 'h-28', 'h-16'];
          const colors = ['#A88A6F', '#D1A974', '#845641'];
          return (
            <div key={u.uid} className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-full flex items-center justify-center font-display text-lg mb-2 bg-white"
                style={{ color: u.avatarColor, border: `2px solid ${u.avatarColor}` }}>
                {u.avatarLetter}
              </div>
              <div className="text-xs font-bold text-[#441514] mb-1 truncate w-full text-center">{u.username}</div>
              <div className="font-mono text-xs text-[#54130E] mb-2">{u.points} tšk.</div>
              <div className={`${heights[idx]} w-full rounded-t-lg flex items-start justify-center pt-2 font-display text-2xl`}
                style={{
                  background: `linear-gradient(180deg, ${colors[realIdx]}30 0%, ${colors[realIdx]}10 100%)`,
                  color: colors[realIdx],
                  border: `1px solid ${colors[realIdx]}30`,
                  borderBottom: 'none'
                }}>
                {realIdx + 1}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Bendri statistikos skaičiavimai - visam pulai
  const totalUsers = sortedUsers.length;
  const totalCompaniesCount = companyStats.length;
  // Didžiausia įmonė pagal narių skaičių
  const largestCompany = companyStats.length > 0
    ? [...companyStats].sort((a, b) => b.memberCount - a.memberCount)[0]
    : null;
  // Tavo pozicija visame pule
  const myRankNum = sortedUsers.findIndex((u) => u.uid === userProfile.uid) + 1;

  return (
    <div className="space-y-4 pb-24 lg:pb-8">
      <div>
        <h1 className="font-display text-3xl lg:text-4xl text-[#441514] mb-1">STATISTIKA</h1>
        <p className="text-sm text-[#845641]">
          {tab === 'overall' && `${sortedUsers.length} ${pluralizeLt(sortedUsers.length, ['dalyvis', 'dalyviai', 'dalyvių'])} · atnaujinama tiesiogiai`}
          {tab === 'company' && userProfile.companyName && `${myCompanyUsers.length} ${pluralizeLt(myCompanyUsers.length, ['dalyvis', 'dalyviai', 'dalyvių'])} iš ${userProfile.companyName}`}
          {tab === 'company' && !userProfile.companyName && 'Tu nepriklausai įmonei'}
          {tab === 'companies' && `${companyStats.length} ${pluralizeLt(companyStats.length, ['įmonė', 'įmonės', 'įmonių'])} · vidurkis vienam dalyviui`}
        </p>
      </div>

      {/* Bendros statistikos kortelės - 4 mini kortelės */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <div className="card-light rounded-xl p-3 text-center transition-transform hover:scale-[1.02]">
          <div className="font-display text-2xl lg:text-3xl text-[#54130E]">{totalUsers}</div>
          <div className="text-[10px] uppercase tracking-wider text-[#845641] mt-1">
            {pluralizeLt(totalUsers, ['Dalyvis', 'Dalyviai', 'Dalyvių'])}
          </div>
        </div>
        <div className="card-light rounded-xl p-3 text-center transition-transform hover:scale-[1.02]">
          <div className="font-display text-2xl lg:text-3xl text-[#6A1107]">{totalCompaniesCount}</div>
          <div className="text-[10px] uppercase tracking-wider text-[#845641] mt-1">
            {pluralizeLt(totalCompaniesCount, ['Įmonė', 'Įmonės', 'Įmonių'])}
          </div>
        </div>
        {largestCompany ? (
          <button
            onClick={() => setShowCompanySizes((v) => !v)}
            className={`card-light rounded-xl p-3 text-center transition-all duration-200 hover:scale-[1.02] hover:brightness-95 active:scale-[0.99] ${showCompanySizes ? 'ring-2 ring-[#54130E]/30' : ''}`}>
            <div className="font-display text-lg lg:text-xl text-[#845641] truncate">
              {largestCompany.companyCode || largestCompany.companyName}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-[#845641] mt-1 flex items-center justify-center gap-1">
              <span>Didžiausia · {largestCompany.memberCount} {pluralizeLt(largestCompany.memberCount, ['dal.', 'dal.', 'dal.'])}</span>
              {showCompanySizes
                ? <ChevronLeft className="w-3 h-3 rotate-90" />
                : <ChevronRight className="w-3 h-3 rotate-90" />}
            </div>
          </button>
        ) : (
          <div className="card-light rounded-xl p-3 text-center opacity-50">
            <div className="font-display text-lg text-[#A88A6F]">—</div>
            <div className="text-[10px] uppercase tracking-wider text-[#845641] mt-1">Didžiausia įmonė</div>
          </div>
        )}
        <div className="card-light rounded-xl p-3 text-center transition-transform hover:scale-[1.02]">
          <div className="font-display text-2xl lg:text-3xl text-[#4A6B47]">
            #{myRankNum || '−'}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-[#845641] mt-1">
            Tavo pozicija · iš {totalUsers}
          </div>
        </div>
      </div>

      {/* Expandable sekcija - rodoma kai paspausta „Didžiausia" kortelė */}
      {showCompanySizes && companiesBySize.length > 0 && (
        <div className="card-light rounded-xl overflow-hidden border-2 border-[#54130E]/15">
          <div className="px-4 py-3 bg-[#54130E]/5 border-b border-[#54130E]/15 flex items-center justify-between">
            <div>
              <div className="font-display text-sm uppercase tracking-wider text-[#54130E]">Dalyvių skaičius pagal įmones</div>
              <div className="text-[10px] text-[#845641] mt-0.5">Rūšiavimas pagal narių skaičių</div>
            </div>
            <button onClick={() => setShowCompanySizes(false)}
              className="text-[#845641] hover:text-[#441514] p-1 rounded-lg hover:bg-[#441514]/5 transition-colors">
              <ChevronLeft className="w-4 h-4 -rotate-90" />
            </button>
          </div>
          <div className="divide-y divide-[#441514]/8">
            {companiesBySize.map((c, i) => {
              const isMyCompany = c.companyId === userProfile.companyId;
              const abbrev = companyAbbreviation({ name: c.companyName, code: c.companyCode });
              const iconClass = abbrev.length > 2
                ? 'w-auto min-w-[40px] px-1.5 h-9 text-xs'
                : 'w-9 h-9 text-sm';
              return (
                <div key={c.companyId}
                  className={`flex items-center gap-3 px-4 py-2.5 ${isMyCompany ? 'bg-[#54130E]/5' : ''}`}>
                  <div className="font-display text-sm w-6 text-center text-[#845641]">{i + 1}</div>
                  <div className={`${iconClass} rounded-lg flex items-center justify-center font-display font-mono tracking-tight bg-[#54130E]/10 text-[#54130E] flex-shrink-0`}>
                    {abbrev}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-semibold truncate ${isMyCompany ? 'text-[#54130E]' : 'text-[#441514]'}`}>
                      {c.companyName} {isMyCompany && <span className="text-[10px] ml-1 opacity-70">(tavo)</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold text-[#54130E]">{c.memberCount}</div>
                    <div className="text-[9px] text-[#845641] uppercase tracking-wider">
                      {pluralizeLt(c.memberCount, ['dal.', 'dal.', 'dal.'])}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-[#441514]/5 lg:max-w-md">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={tab === t.id ? { backgroundColor: '#ffffff', color: '#441514' } : { color: '#845641' }}
            className="flex-1 py-2 px-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all">
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB: BENDRA */}
      {tab === 'overall' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:items-start">
          <div className="lg:col-span-2">{renderPodium(sortedUsers)}</div>
          <div className="card-light rounded-xl overflow-hidden lg:col-span-3">
            {sortedUsers.map((u, i) => renderUserRow(u, i, u.uid === userProfile.uid))}
          </div>
        </div>
      )}

      {/* TAB: MANO ĮMONĖ */}
      {tab === 'company' && (
        <>
          {!userProfile.companyId ? (
            <div className="card-light rounded-xl p-6 text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[#441514]/5 flex items-center justify-center">
                <Settings className="w-6 h-6 text-[#845641]" />
              </div>
              <p className="text-sm font-bold text-[#441514] mb-1">Tu nepriklausai įmonei</p>
              <p className="text-xs text-[#845641]">Susisiek su administratoriumi, kad priskirtų tave įmonei.</p>
            </div>
          ) : (
            <>
              <div className="card-light rounded-xl p-3 flex items-center gap-2 lg:max-w-md">
                <div className="w-2 h-8 rounded-full bg-[#54130E]"></div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-[#845641] uppercase tracking-wider">Tavo įmonė</div>
                  <div className="font-display text-base text-[#441514] truncate">{userProfile.companyName}</div>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:items-start">
                <div className="lg:col-span-2">{renderPodium(myCompanyUsers)}</div>
                <div className="card-light rounded-xl overflow-hidden lg:col-span-3">
                  {myCompanyUsers.map((u, i) => renderUserRow(u, i, u.uid === userProfile.uid))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* TAB: ĮMONĖS */}
      {tab === 'companies' && (
        <>
          <div className="rounded-xl p-3 bg-[#54130E]/5 border border-[#54130E]/15">
            <p className="text-[11px] text-[#54130E] leading-relaxed">
              <span className="font-bold">Kaip skaičiuojama:</span> įmonės rikiuojamos pagal taškų <span className="font-bold">vidurkį vienam dalyviui</span>.
              Taip mažos įmonės gali sąžiningai konkuruoti su didelėmis — dydis nesuteikia pranašumo.
            </p>
          </div>

          {companyStats.length === 0 ? (
            <div className="card-light rounded-xl p-6 text-center">
              <p className="text-sm text-[#845641]">Dar nėra įmonių su dalyviais</p>
            </div>
          ) : (
            <div className="card-light rounded-xl overflow-hidden">
              {companyStats.map((c, i) => {
                const isMyCompany = c.companyId === userProfile.companyId;
                const abbrev = companyAbbreviation({ name: c.companyName, code: c.companyCode });
                const iconClass = abbrev.length > 2
                  ? 'w-auto min-w-[40px] px-1.5 h-9 text-xs'
                  : 'w-9 h-9 text-sm';
                return (
                  <div key={c.companyId}
                    className={`flex items-center gap-3 p-3 border-b border-[#441514]/8 last:border-0 ${isMyCompany ? 'bg-[#54130E]/5' : ''}`}>
                    <div className="font-display text-sm w-6 text-center text-[#845641]">{i + 1}</div>
                    <div className={`${iconClass} rounded-lg flex items-center justify-center font-display font-mono tracking-tight bg-[#54130E]/10 text-[#54130E] flex-shrink-0`}>
                      {abbrev}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-semibold truncate ${isMyCompany ? 'text-[#54130E]' : 'text-[#441514]'}`}>
                        {c.companyName} {isMyCompany && <span className="text-[10px] ml-1 opacity-70">(tavo)</span>}
                      </div>
                      <div className="text-[10px] text-[#845641]">
                        {c.memberCount} {pluralizeLt(c.memberCount, ['dalyvis', 'dalyviai', 'dalyvių'])} · {c.totalPoints} tšk. iš viso
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-bold text-[#54130E]">{c.avgPoints.toFixed(1)}</div>
                      <div className="text-[9px] text-[#845641] uppercase tracking-wider">vid.</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

const ProfileScreen = ({ userProfile, usersWithPoints, matches, predictions, tournamentResults, onLogout, onOpenAdmin, onProfileUpdated }) => {
  const { confirm, notify, dialog } = useDialog();
  const [showDeleteForm, setShowDeleteForm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(userProfile.fullName || '');
  const [savingName, setSavingName] = useState(false);
  const me = usersWithPoints.find((u) => u.uid === userProfile.uid) || userProfile;
  const finishedMatches = matches.filter((m) => m.status === 'finished');

  // Vardo/pavardės keitimas (saugoma users_private/{uid}.fullName)
  const handleSaveName = async () => {
    const trimmed = (nameDraft || '').trim();
    if (trimmed === (userProfile.fullName || '')) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      await updateOwnFullName(trimmed);
      // Atnaujinti lokaliai - users_private listener'io nėra ne-admin'ams,
      // taigi reikia pranešti tėvinei komponentei
      if (onProfileUpdated) onProfileUpdated({ fullName: trimmed });
      setEditingName(false);
    } catch (err) {
      await notify({
        title: 'Klaida išsaugant',
        message: err.message || 'Nepavyko atnaujinti vardo. Bandyk dar kartą.',
        variant: 'danger',
      });
    } finally {
      setSavingName(false);
    }
  };

  // Paskyros ištrynimas su slaptažodžio reauth ir patvirtinimu
  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      await notify({ title: 'Klaida', message: 'Įvesk slaptažodį patvirtinimui', variant: 'danger' });
      return;
    }
    const confirmed = await confirm({
      title: 'Ar tikrai ištrinti paskyrą?',
      message: 'PASKUTINIS ĮSPĖJIMAS: bus negrįžtamai ištrinti VISI tavo duomenys — el. paštas, vardas, prognozės, taškai, pozicija bendroje įskaitoje. Šio veiksmo atšaukti negalima.',
      confirmLabel: 'Taip, ištrinti viską',
      variant: 'danger',
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await deleteUserAccount(deletePassword);
      // Po sėkmingo ištrynimo Firebase auto-signs out, onAuthChange perduoda į LoginScreen
      // notify nereikia - per ~1 sek pasikeis ekranas
    } catch (err) {
      await notify({
        title: 'Klaida ištrinant paskyrą',
        message: err.message || 'Nepavyko ištrinti paskyros. Bandyk dar kartą.',
        variant: 'danger',
      });
      setDeleting(false);
    }
  };

  const stats = useMemo(() => {
    let exact = 0, diff = 0, outcome = 0, wrong = 0, missed = 0;
    finishedMatches.forEach((m) => {
      const pred = predictions[m.id];
      if (!pred) {
        missed++;
        return;
      }
      const r = calculatePoints(pred, m.actualScore);
      if (r.type === 'exact') exact++;
      else if (r.type === 'diff') diff++;
      else if (r.type === 'outcome') outcome++;
      else wrong++;
    });
    const predicted = exact + diff + outcome + wrong;
    return { exact, diff, outcome, wrong, missed, predicted, total: finishedMatches.length };
  }, [predictions, finishedMatches]);

  return (
    <div className="space-y-4 pb-24 lg:pb-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:items-start">
      <div className="card-light rounded-2xl p-5 text-center">
        <div className="w-20 h-20 rounded-full mx-auto mb-3 flex items-center justify-center font-display text-3xl bg-[#FFFFFF]"
          style={{ color: userProfile.avatarColor, border: `3px solid ${userProfile.avatarColor}` }}>
          {userProfile.avatarLetter}
        </div>
        <h2 className="font-display text-2xl text-[#441514]">{userProfile.username}</h2>
        {editingName ? (
          <div className="mt-2 flex items-center gap-1.5 justify-center max-w-xs mx-auto">
            <input
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              disabled={savingName}
              maxLength={200}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveName();
                else if (e.key === 'Escape') { setNameDraft(userProfile.fullName || ''); setEditingName(false); }
              }}
              className="flex-1 min-w-0 px-2 py-1 rounded-md bg-[#FFFFFF] border border-[#845641]/40 text-sm text-[#441514] focus:outline-none focus:border-[#54130E] focus:ring-1 focus:ring-[#54130E]/20"
              placeholder="Vardas Pavardė"
            />
            <button onClick={handleSaveName} disabled={savingName}
              title="Išsaugoti"
              className="p-1.5 rounded-md bg-[#54130E] text-white hover:brightness-110 disabled:opacity-50 flex-shrink-0">
              {savingName ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            </button>
            <button onClick={() => { setNameDraft(userProfile.fullName || ''); setEditingName(false); }}
              disabled={savingName}
              title="Atšaukti"
              className="p-1.5 rounded-md bg-[#FFFFFF] text-[#845641] border border-[#845641]/30 hover:bg-[#FAF0E0] disabled:opacity-50 flex-shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1.5 mt-1">
            <p className="text-sm text-[#441514]">{userProfile.fullName}</p>
            <button onClick={() => { setNameDraft(userProfile.fullName || ''); setEditingName(true); }}
              title="Keisti vardą / pavardę"
              className="p-1 rounded-md text-[#845641] hover:bg-[#845641]/10 transition-colors">
              <Pencil className="w-3 h-3" />
            </button>
          </div>
        )}
        <p className="text-xs text-[#845641]">{userProfile.email}</p>

        {/* Įmonės informacija */}
        <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#54130E]/8 border border-[#54130E]/20">
          <Trophy className="w-3 h-3 text-[#54130E]" />
          <span className="text-[10px] font-bold text-[#54130E] uppercase tracking-wider">
            {userProfile.companyCode && (
              <span className="font-mono mr-1">{userProfile.companyCode}</span>
            )}
            {userProfile.companyName || 'Be įmonės'}
          </span>
        </div>

        {userProfile.isAdmin && (
          <div className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full bg-[#54130E]/10 border border-[#54130E]/30 ml-2">
            <Settings className="w-3 h-3 text-[#54130E]" />
            <span className="text-[10px] font-bold text-[#54130E] uppercase tracking-wider">Administratorius</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:col-span-2 lg:grid-cols-2 lg:self-stretch">
        <div className="card-light rounded-xl p-4 flex flex-col justify-center">
          <div className="text-[10px] text-[#845641] uppercase tracking-wider mb-1">Iš viso taškų</div>
          <div className="font-display text-3xl lg:text-5xl text-[#54130E]">{me.points || 0}</div>
        </div>
        <div className="card-light rounded-xl p-4 flex flex-col justify-center">
          <div className="text-[10px] text-[#845641] uppercase tracking-wider mb-1">Tikslių rezultatų</div>
          <div className="font-display text-3xl lg:text-5xl text-[#D1A974]">{stats.exact}</div>
        </div>
      </div>
      </div>

      <div className="card-light rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-sm uppercase tracking-wider text-[#441514]">Tikslumas</h3>
          <span className="text-[10px] text-[#845641]">
            {stats.predicted}/{stats.total} sp{pluralizeLt(stats.predicted, ['ėjimas', 'ėjimai', 'ėjimų'])}
            {stats.missed > 0 && ` · ${stats.missed} praleist${pluralizeLt(stats.missed, ['a', 'os', 'ų'])}`}
          </span>
        </div>
        <div className="space-y-2">
          {[
            { label: 'Tikslus rezultatas', count: stats.exact, color: '#54130E' },
            { label: 'Teisingas skirtumas', count: stats.diff, color: '#D1A974' },
            { label: 'Tik baigtis', count: stats.outcome, color: '#54130E' },
            { label: 'Pro šalį', count: stats.wrong, color: '#A88A6F' },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-3">
              <div className="text-xs flex-1 text-[#441514]">{s.label}</div>
              <div className="flex-1 h-1.5 bg-[#441514]/8 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{
                  width: `${stats.predicted ? (s.count / stats.predicted) * 100 : 0}%`,
                  backgroundColor: s.color
                }} />
              </div>
              <div className="font-mono text-xs font-bold w-8 text-right" style={{ color: s.color }}>{s.count}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Turnyro prognozių rezultatas - rodyti tik jei admin'as suvedė rezultatus */}
      {tournamentResults && (me.tournamentPoints > 0 || me.tournamentBreakdown) && (
        <div className="card-light rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-sm uppercase tracking-wider text-[#441514]">Turnyro prognozės</h3>
            <span className="font-mono text-sm font-bold text-[#54130E]">+{me.tournamentPoints || 0} tšk.</span>
          </div>
          <div className="space-y-1.5">
            {[
              { label: 'Čempionas', key: 'champion', points: 25, color: '#D1A974' },
              { label: 'Geriausias žaidėjas', key: 'bestPlayer', points: 15, color: '#D1A974' },
              { label: 'Strielcas', key: 'topScorer', points: 15, color: '#54130E' },
              { label: 'Vartininkas', key: 'bestGoalkeeper', points: 15, color: '#54130E' },
              { label: 'Jaunasis', key: 'bestYoungPlayer', points: 15, color: '#6A1107' },
            ].map((row) => {
              const earned = me.tournamentBreakdown?.[row.key] > 0;
              const hasResult = row.key === 'champion' ? !!tournamentResults.champion : !!tournamentResults[row.key];
              if (!hasResult) return null;
              return (
                <div key={row.key} className="flex items-center justify-between text-xs">
                  <span className="text-[#441514]">{row.label}</span>
                  {earned ? (
                    <span className="font-mono font-bold" style={{ color: row.color }}>+{row.points} tšk.</span>
                  ) : (
                    <span className="text-[#A88A6F]">−</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {userProfile.isAdmin && (
        <button onClick={onOpenAdmin}
          style={{ background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)', color: '#ffffff' }}
          className="w-full py-3 rounded-xl font-display uppercase tracking-wider shadow-md transition-all duration-200 hover:scale-[1.02] hover:brightness-110 hover:shadow-lg active:scale-[0.98] text-sm flex items-center justify-center gap-2">
          <Settings className="w-4 h-4" /> Administratoriaus skydas
        </button>
      )}

      <button onClick={onLogout}
        style={{ backgroundColor: '#ffffff', color: '#6A1107', border: '1px solid rgba(106, 17, 7, 0.3)' }}
        className="w-full py-3 rounded-xl font-display uppercase tracking-wider transition-colors text-sm flex items-center justify-center gap-2 hover:bg-[#6A1107]/5">
        <LogOut className="w-4 h-4" /> Atsijungti
      </button>

      {/* === PASKYROS IŠTRYNIMAS (GDPR „right to erasure") === */}
      <div className="rounded-xl p-4 bg-[#54130E]/5 border border-[#54130E]/15 mt-6">
        <div className="flex items-start gap-2 mb-3">
          <AlertCircle className="w-4 h-4 text-[#54130E] flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-[10px] font-bold text-[#54130E] uppercase tracking-wider mb-1">Pavojinga zona</div>
            <p className="text-[11px] text-[#845641] leading-relaxed">
              Paskyros ištrynimas pašalins <strong>VISUS</strong> tavo duomenis: el. paštą, vardą, prognozes, taškus.
              Šio veiksmo atšaukti <strong>NEGALIMA</strong>.
            </p>
          </div>
        </div>

        {!showDeleteForm ? (
          <button onClick={() => setShowDeleteForm(true)}
            style={{ backgroundColor: '#FFFFFF', color: '#54130E', border: '1px solid rgba(84, 19, 14, 0.4)' }}
            className="w-full py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors hover:bg-[#54130E]/5 flex items-center justify-center gap-2">
            <AlertCircle className="w-3.5 h-3.5" /> Ištrinti mano paskyrą
          </button>
        ) : (
          <div className="space-y-2 pt-2 border-t border-[#54130E]/15">
            <label className="text-[10px] font-bold text-[#845641] uppercase tracking-wider block">
              Patvirtink slaptažodžiu
            </label>
            <input type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={deleting}
              className="w-full px-3 py-2 rounded-lg bg-[#FFFFFF] border border-[#54130E]/30 text-sm focus:outline-none focus:border-[#54130E] focus:ring-2 focus:ring-[#54130E]/15" />
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setShowDeleteForm(false); setDeletePassword(''); }}
                disabled={deleting}
                style={{ backgroundColor: '#FFFFFF', color: '#845641', border: '1px solid rgba(132, 86, 65, 0.3)' }}
                className="flex-1 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors hover:bg-[#FAF0E0] disabled:opacity-50">
                Atšaukti
              </button>
              <button onClick={handleDeleteAccount}
                disabled={deleting || !deletePassword}
                style={{ backgroundColor: '#54130E', color: '#FFFFFF' }}
                className="flex-1 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all duration-200 hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2">
                {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {deleting ? 'Trinama...' : 'Ištrinti visiškai'}
              </button>
            </div>
          </div>
        )}
      </div>

      {dialog}
    </div>
  );
};

// === RULES SCREEN (taisyklės ir taškų skaičiavimo logika) ===

const RuleSection = ({ icon: Icon, title, color = '#54130E', children }) => (
  <div className="card-light rounded-2xl p-5">
    <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#441514]/8">
      <Icon className="w-5 h-5" style={{ color }} />
      <h3 className="font-display text-base uppercase tracking-wider text-[#441514]">{title}</h3>
    </div>
    {children}
  </div>
);

const PointsRow = ({ label, points, color, example }) => (
  <div className="flex items-start gap-3 py-2 border-b border-[#441514]/5 last:border-0">
    <div className="flex-shrink-0 w-14 text-center">
      <div className="font-display text-xl" style={{ color }}>+{points}</div>
      <div className="text-[9px] text-[#845641] uppercase tracking-wider">tšk.</div>
    </div>
    <div className="flex-1 min-w-0">
      <div className="text-sm font-semibold text-[#441514]">{label}</div>
      {example && <div className="text-[11px] text-[#845641] mt-0.5">{example}</div>}
    </div>
  </div>
);

const RulesScreen = () => {
  return (
    <div className="space-y-4 pb-24 lg:pb-8">
      <div>
        <h1 className="font-display text-3xl lg:text-4xl text-[#441514] mb-1">TAISYKLĖS</h1>
        <p className="text-sm text-[#845641]">Kaip žaisti, kaip skaičiuojami taškai, kaip rikiuojama bendra įskaita</p>
      </div>

      {/* Apžvalga */}
      <RuleSection icon={Info} title="Apžvalga" color="#54130E">
        <p className="text-sm text-[#441514] leading-relaxed">
          PFČ 2026 totalizatorius — vidinis pasaulio futbolo čempionato 2026 m. spėjimų ratas.
          Spėk kiekvienų rungtynių rezultatą bei turnyro pabaigos statistiką (čempionas, geriausi žaidėjai)
          ir rink taškus. Nugalėtojas paaiškės po finalo.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg bg-[#54130E]/5 px-3 py-2">
            <div className="text-[#845641] uppercase tracking-wider text-[9px]">Turnyras</div>
            <div className="font-bold text-[#441514]">2026-06-11 — 2026-07-19</div>
          </div>
          <div className="rounded-lg bg-[#54130E]/5 px-3 py-2">
            <div className="text-[#845641] uppercase tracking-wider text-[9px]">Iš viso rungtynių</div>
            <div className="font-bold text-[#441514]">72 grupių + 32 atkrintamųjų</div>
          </div>
        </div>
      </RuleSection>

      {/* Kaip dalyvauti */}
      <RuleSection icon={CheckCircle2} title="Kaip dalyvauti" color="#54130E">
        <ol className="space-y-2 text-sm text-[#441514]">
          <li className="flex gap-2"><span className="font-mono font-bold text-[#54130E]">1.</span>Užsiregistruok ir pasirink savo įmonę (arba „Be įmonės")</li>
          <li className="flex gap-2"><span className="font-mono font-bold text-[#54130E]">2.</span>Iki turnyro pradžios suvesk turnyro prognozes (čempionas + 4 žaidėjų kategorijos)</li>
          <li className="flex gap-2"><span className="font-mono font-bold text-[#54130E]">3.</span>Prieš kiekvienas rungtynes spėk rezultatą</li>
          <li className="flex gap-2"><span className="font-mono font-bold text-[#54130E]">4.</span>Po kiekvienų rungtynių taškai pridedami automatiškai</li>
          <li className="flex gap-2"><span className="font-mono font-bold text-[#54130E]">5.</span>Sek savo poziciją Lyderių skiltyje</li>
        </ol>
      </RuleSection>

      {/* Rungtynių prognozės - taškai */}
      <RuleSection icon={Target} title="Rungtynių prognozės" color="#54130E">
        <p className="text-xs text-[#845641] mb-3">
          Už kiekvienas pasibaigusias rungtynes gauni taškų pagal tai, kaip arti tikro rezultato atspėjai.
        </p>
        <div>
          <PointsRow
            label="Tikslus rezultatas"
            points={5}
            color="#54130E"
            example="Tikras 2:1 · spėjai 2:1 → +5 tšk." />
          <PointsRow
            label="Teisingas įvarčių skirtumas"
            points={3}
            color="#D1A974"
            example="Tikras 2:1 · spėjai 3:2 (abiejų skirtumas +1) → +3 tšk." />
          <PointsRow
            label="Tik teisinga baigtis (nugalėtojas arba lygiosios)"
            points={2}
            color="#54130E"
            example="Tikras 2:1 · spėjai 4:1 (abiem atvejais nugali šeimininkai) → +2 tšk." />
          <PointsRow
            label="Pro šalį"
            points={0}
            color="#A88A6F"
            example="Tikras 2:1 · spėjai 1:2 (kita baigtis) → 0 tšk." />
        </div>
        <div className="mt-3 rounded-lg bg-[#54130E]/5 border border-[#54130E]/15 p-3">
          <p className="text-xs text-[#441514]">
            <strong>Pastaba:</strong> jei nespėjai pažymėti spėjimo iki rungtynių pradžios — gauni 0 tšk., bet tai nenutraukia „serijos" skaičiavimo nuo kitų rungtynių.
          </p>
        </div>
      </RuleSection>

      {/* Turnyro prognozės - taškai */}
      <RuleSection icon={Crown} title="Turnyro prognozės" color="#D1A974">
        <p className="text-xs text-[#845641] mb-3">
          Vienkartinės prognozės prieš turnyro pradžią. Prasidėjus turnyrui <strong>nebegalima keisti</strong>.
        </p>
        <div>
          <PointsRow
            label="Čempionas"
            points={25}
            color="#D1A974"
            example="Spėk komandą, kuri laimės finalą" />
          <PointsRow
            label="Geriausias turnyro žaidėjas"
            points={15}
            color="#D1A974"
            example={'FIFA „Auksinio kamuolio" laimėtojas'} />
          <PointsRow
            label="Daugiausiai įvarčių įmušęs žaidėjas"
            points={15}
            color="#54130E"
            example={'FIFA „Auksinio bato" laimėtojas'} />
          <PointsRow
            label="Geriausias vartininkas"
            points={15}
            color="#54130E"
            example={'FIFA „Auksinės pirštinės" laimėtojas'} />
          <PointsRow
            label="Geriausias 21 m. ar jaunesnis žaidėjas"
            points={15}
            color="#6A1107"
            example="FIFA geriausio jauno žaidėjo apdovanojimas" />
        </div>
        <div className="mt-3 rounded-lg bg-[#D1A974]/5 border border-[#D1A974]/15 p-3">
          <p className="text-xs text-[#441514]">
            <strong>Maksimumas už turnyro prognozes:</strong> 25 + 4×15 = <span className="font-mono font-bold">85 tšk.</span>
          </p>
          <p className="text-[11px] text-[#845641] mt-1">
            Žaidėjų vardai lyginami neatsižvelgiant į raidžių registrą ir tarpus (pvz., „MESSI", „messi", „Lionel Messi" — laikomi tuo pačiu, jei administratorius įvedė tinkamai).
          </p>
        </div>
      </RuleSection>

      {/* Terminai */}
      <RuleSection icon={Lock} title="Spėjimų terminai" color="#6A1107">
        <div className="space-y-3">
          <div>
            <div className="text-sm font-bold text-[#441514] mb-1">Rungtynių spėjimai</div>
            <p className="text-xs text-[#845641] leading-relaxed">
              Galima keisti iki rungtynių pradžios. Vos rungtynės prasideda — spėjimas užšaldomas. Tai tikrinama serveryje, tad apeiti negalima.
            </p>
          </div>
          <div>
            <div className="text-sm font-bold text-[#441514] mb-1">Turnyro prognozės</div>
            <p className="text-xs text-[#845641] leading-relaxed">
              Galima keisti iki <span className="font-mono font-bold text-[#441514]">2026-06-11 03:00 LT</span> (turnyro pradžios). Po šio momento prognozės užšaldomos visam laikui. Spėti reikia iki turnyro atidarymo dienos.
            </p>
          </div>
        </div>
      </RuleSection>

      {/* Serija */}
      <RuleSection icon={Flame} title="Serija" color="#D1A974">
        <p className="text-sm text-[#441514] leading-relaxed">
          Serija — kelios iš eilės atspėtos rungtynės (bent 2 tšk. už kiekvienas). Skaičiuojama atgal nuo paskutinių pasibaigusių rungtynių. Pirmas 0 tšk. spėjimas nutraukia seriją.
        </p>
        <div className="mt-3 text-[11px] text-[#845641]">
          <strong>Pavyzdys:</strong> jei trejos paskutinės rungtynės davė tau 3, 2, 5 tšk., o ketvirtos — 0 tšk., tavo serija lygi <span className="font-mono font-bold text-[#D1A974]">3</span>.
        </div>
      </RuleSection>

      {/* Lyderių lentelė */}
      <RuleSection icon={BarChart3} title="Lyderių lentelė" color="#54130E">
        <div className="space-y-3">
          <div>
            <div className="text-sm font-bold text-[#441514] mb-1">Bendra — pagal asmeninius taškus</div>
            <p className="text-xs text-[#845641]">
              Bendros sumos rikiuojamos mažėjimo tvarka. Iš viso = rungtynių taškai + turnyro prognozių taškai.
            </p>
          </div>
          <div>
            <div className="text-sm font-bold text-[#441514] mb-1">Įmonės — pagal vidurkį vienam dalyviui</div>
            <p className="text-xs text-[#845641]">
              Sudedami visų įmonės dalyvių taškai ir dalijami iš dalyvių skaičiaus. Taip mažos įmonės sąžiningai varžosi su didelėmis — kolektyvo dydis nesuteikia pranašumo.
            </p>
          </div>
        </div>
      </RuleSection>

      {/* === PRIZAI === */}
      <RuleSection icon={Gift} title="Prizai" color="#D1A974">
        {/* Pagrindinis akcentas su gradient'u */}
        <div className="rounded-xl p-4 mb-4 text-center relative overflow-hidden"
          style={{ background: 'linear-gradient(135deg, #D1A974 0%, #FFFFFF 50%, #D1A974 100%)', border: '1px solid rgba(132, 86, 65, 0.3)' }}>
          <Trophy className="w-7 h-7 mx-auto mb-2 text-[#6A1107]" />
          <div className="font-display text-2xl text-[#441514] mb-1">4 NUGALĖTOJAI</div>
          <p className="text-[11px] text-[#845641] uppercase tracking-widest">
            iš bendros įskaitos
          </p>
          <div className="flex items-center justify-center gap-2 mt-3 text-xs text-[#441514]">
            <span className="font-bold">2</span>
            <span className="opacity-70">iš administracijos</span>
            <span className="text-[#845641] opacity-50">·</span>
            <span className="font-bold">2</span>
            <span className="opacity-70">iš darbininkų</span>
          </div>
        </div>

        {/* Dvi kategorijos šalia */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { key: 'admin', label: 'Administracija' },
            { key: 'workers', label: 'Darbininkai' },
          ].map((cat) => (
            <div key={cat.key} className="card-light rounded-xl overflow-hidden">
              <div className="px-4 py-2 text-center"
                style={{ background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)' }}>
                <span className="font-display text-xs uppercase tracking-widest text-[#D1A974]">
                  {cat.label}
                </span>
              </div>
              <div className="p-3 space-y-3">
                {/* I vieta - aukso */}
                <div className="flex gap-3 items-start">
                  <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center shadow-md"
                    style={{ background: 'linear-gradient(135deg, #E8C77A 0%, #D1A974 50%, #845641 100%)' }}>
                    <Crown className="w-5 h-5 text-[#FFFFFF]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#D1A974] mb-0.5">
                      I vieta
                    </div>
                    <div className="text-xs text-[#441514] leading-snug">
                      Kamuolys <span className="opacity-50">+</span> šalikas <span className="opacity-50">+</span> VMG atributika
                    </div>
                  </div>
                </div>

                {/* II vieta - sidabro */}
                <div className="flex gap-3 items-start pt-2 border-t border-[#441514]/8">
                  <div className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center shadow-md"
                    style={{ background: 'linear-gradient(135deg, #B5A18F 0%, #A88A6F 50%, #845641 100%)' }}>
                    <Award className="w-5 h-5 text-[#FFFFFF]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#A88A6F] mb-0.5">
                      II vieta
                    </div>
                    <div className="text-xs text-[#441514] leading-snug">
                      VMG atributika
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Apatinė pastaba */}
        <div className="mt-4 rounded-lg p-3 bg-[#D1A974]/8 border border-[#D1A974]/25">
          <p className="text-[11px] text-[#441514] leading-relaxed">
            <span className="font-bold">Spėk gerai — laimėk!</span> Apdovanojimai bus įteikiami po finalo, kai paaiškės galutinė lentelės pozicija. Sėkmės ir kuo daugiau tikslių spėjimų!
          </p>
        </div>
      </RuleSection>

      {/* Grupių etapas */}
      <RuleSection icon={Shield} title="Grupių etapas" color="#54130E">
        <p className="text-sm text-[#441514] leading-relaxed mb-3">
          12 grupių (A–L) po 4 komandas, kiekviena žaidžia su kitomis grupės narėmis (3 rungtynės kiekvienai komandai = iš viso 72 grupių etapo rungtynės).
        </p>
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-3 rounded-full bg-[#4A6B47]" />
            <span className="text-[#441514]"><strong>1-2 vieta</strong> — tiesiogiai į atkrintamųjų varžybų etapą (1/16 finalo)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-3 rounded-full bg-[#C97D3F]" />
            <span className="text-[#441514]"><strong>3 vieta</strong> — 8 geriausios (iš 12) taip pat patenka į atkrintamąsias</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-3 rounded-full bg-[#6A1107]" />
            <span className="text-[#441514]"><strong>4 vieta</strong> — iškrenta iš turnyro</span>
          </div>
        </div>
        <div className="mt-3 rounded-lg bg-[#54130E]/5 border border-[#54130E]/15 p-3">
          <div className="text-[11px] font-bold text-[#441514] uppercase tracking-wider mb-1">Rikiavimo tvarka</div>
          <ol className="text-[11px] text-[#845641] space-y-0.5 ml-4 list-decimal">
            <li>Taškai (3 už pergalę, 1 už lygiąsias)</li>
            <li>Įvarčių skirtumas (įmušti − praleisti)</li>
            <li>Įmušti įvarčiai</li>
          </ol>
          <p className="text-[10px] text-[#845641] mt-2 italic">
            Pastaba: FIFA naudoja papildomus kriterijus (tarpusavio rungtynės, drausmės taškai, burtai), bet retais atvejais — ši aplikacija rodo paprastesnę versiją.
          </p>
        </div>
      </RuleSection>

      {/* Atkrintamųjų varžybų etapas */}
      <RuleSection icon={Award} title="Atkrintamųjų varžybų etapas" color="#54130E">
        <p className="text-sm text-[#441514] leading-relaxed mb-3">
          32 komandos atkrenta vienos su kitomis. Lygiosios pagrindinio laiko pabaigoje → pratęsimas → 11 m. baudinių serija.
        </p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {[
            { stage: '1/16 finalas', matches: 16, dates: '2026-06-28 → 07-03' },
            { stage: 'Aštuntfinalis', matches: 8, dates: '2026-07-04 → 07-07' },
            { stage: 'Ketvirtfinalis', matches: 4, dates: '2026-07-09 → 07-11' },
            { stage: 'Pusfinalis', matches: 2, dates: '2026-07-14 → 07-15' },
            { stage: 'Dėl 3 vietos', matches: 1, dates: '2026-07-18' },
            { stage: 'Finalas', matches: 1, dates: '2026-07-19' },
          ].map((s) => (
            <div key={s.stage} className="rounded-lg bg-[#54130E]/5 px-3 py-2">
              <div className="font-bold text-[#441514]">{s.stage}</div>
              <div className="text-[10px] text-[#845641]">{s.matches} {pluralizeLt(s.matches, ['rungtynės', 'rungtynės', 'rungtynių'])}</div>
              <div className="text-[10px] text-[#845641]">{s.dates}</div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-[#845641] mt-3">
          Spėjimams galioja ta pati skaičiavimo logika kaip ir grupių etape (5/3/2 tšk.). Po 11 m. baudinių serijos rezultatas fiksuojamas pagal pagrindinio laiko pabaigą (paprastai 1:1, 2:2 ir pan.).
        </p>
      </RuleSection>

      {/* === PRIVATUMO POLITIKA === */}
      <RuleSection icon={Lock} title="Privatumo politika" color="#845641">
        {/* Duomenų valdytojas */}
        <div className="space-y-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#845641] mb-1">Duomenų valdytojas</div>
            <p className="text-xs text-[#441514] leading-relaxed">
              Kontaktas dėl duomenų užklausų:{' '}
              <a href="mailto:paulius.barzdonis@mediena.lt"
                className="font-mono font-bold text-[#6A1107] hover:underline">
                paulius.barzdonis@mediena.lt
              </a>
            </p>
          </div>

          {/* Kokie duomenys renkami */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#845641] mb-1">Kokie duomenys renkami</div>
            <ul className="text-xs text-[#441514] space-y-1 ml-4 list-disc leading-relaxed">
              <li><strong>El. paštas, slaptažodis</strong> — paskyros sukūrimui (slaptažodis saugomas tik bcrypt hash'u, niekam neprieinamas)</li>
              <li><strong>Vardas, pavardė</strong> — identifikacijai (matomas tik tau ir administratoriui)</li>
              <li><strong>Vartotojo vardas, įmonė, prognozės, taškai</strong> — žaidimo logikai (matomi kitiems dalyviams)</li>
              <li><strong>Naršyklės elgesio signalai</strong> (anonimizuoti) — Google reCAPTCHA naudoja botų atskyrimui</li>
            </ul>
          </div>

          {/* Kur saugoma + 3čios šalys */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#845641] mb-1">Kur saugoma · trečiosios šalys</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
              <div className="rounded-lg p-3 bg-[#54130E]/5 border border-[#54130E]/15">
                <div className="font-bold text-xs text-[#441514] mb-1">Google Firebase</div>
                <p className="text-[11px] text-[#845641] leading-relaxed">
                  Autentifikacija + duomenų bazė. ES datacenter'iai. Pasirašyti DPA (Data Processing Addendum). GDPR atitinka.
                </p>
              </div>
              <div className="rounded-lg p-3 bg-[#54130E]/5 border border-[#54130E]/15">
                <div className="font-bold text-xs text-[#441514] mb-1">Netlify</div>
                <p className="text-[11px] text-[#845641] leading-relaxed">
                  Aplikacijos kodo hosting'as. Jokie asmens duomenys nesaugomi.
                </p>
              </div>
              <div className="rounded-lg p-3 bg-[#54130E]/5 border border-[#54130E]/15">
                <div className="font-bold text-xs text-[#441514] mb-1">Google reCAPTCHA v3</div>
                <p className="text-[11px] text-[#845641] leading-relaxed">
                  Botų apsauga. Renkami tik anonimizuoti elgesio signalai.
                </p>
              </div>
              <div className="rounded-lg p-3 bg-[#54130E]/5 border border-[#54130E]/15">
                <div className="font-bold text-xs text-[#441514] mb-1">Google Fonts</div>
                <p className="text-[11px] text-[#845641] leading-relaxed">
                  Montserrat šrifto pateikimas. Renkamas tik IP.
                </p>
              </div>
            </div>
          </div>

          {/* Saugumo priemonės */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#845641] mb-1">Saugumo priemonės</div>
            <ul className="text-xs text-[#441514] space-y-1 ml-4 list-disc leading-relaxed">
              <li>Visi duomenys siunčiami HTTPS šifruotai</li>
              <li>Slaptažodžiai bcrypt hash'uoti (niekas niekada nemato originalo)</li>
              <li>Vardas/pavardė atskirti į privačią Firestore kolekciją (tik tau + admin'ui)</li>
              <li>Server-side validacija per Firestore Security Rules</li>
              <li>Admin veiksmai užfiksuoti audit log'e</li>
              <li>Firebase App Check su reCAPTCHA — apsauga nuo bot'ų</li>
            </ul>
          </div>

          {/* Tavo teisės */}
          <div className="rounded-lg p-3 bg-[#D1A974]/10 border border-[#D1A974]/30">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#6A1107] mb-2">Tavo teisės pagal GDPR</div>
            <ul className="text-xs text-[#441514] space-y-1 ml-4 list-disc leading-relaxed">
              <li><strong>Prieiga</strong> — gali bet kada matyti, kokie tavo duomenys saugomi</li>
              <li><strong>Taisymas</strong> — gali keisti netiksliai įvestus duomenis</li>
              <li><strong>Ištrynimas</strong> — Profile ekrane gali ištrinti visą savo paskyrą (visi tavo duomenys pašalinami)</li>
              <li><strong>Apribojimas</strong> — gali paprašyti laikinai sustabdyti tavo duomenų tvarkymą</li>
            </ul>
          </div>

          {/* Saugojimo terminas */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#845641] mb-1">Saugojimo terminas</div>
            <p className="text-xs text-[#441514] leading-relaxed">
              Tavo duomenys saugomi iki turnyro pabaigos + 30 dienų po jo (apdovanojimų įteikimui ir statistikų peržiūrai).
              Po to visi PII duomenys (el. paštas, vardas/pavardė) automatiškai pašalinami arba anonimizuojami.
              Bet kada gali paprašyti ankstesnio ištrynimo.
            </p>
          </div>
        </div>
      </RuleSection>

      {/* Kontaktas / klausimai */}
      <RuleSection icon={AlertCircle} title="Klausimai?" color="#D1A974">
        <p className="text-sm text-[#441514] leading-relaxed">
          Jei radai klaidą, ko nors trūksta arba reikia daugiau funkcijų — susisiek su administratoriumi. Šis totalizatorius yra vidinis, todėl visi atnaujinimai daromi pagal dalyvių pasiūlymus.
        </p>
        <div className="mt-3 rounded-lg p-3 flex items-center gap-2 bg-[#D1A974]/10 border border-[#D1A974]/30">
          <span className="text-[10px] font-bold text-[#845641] uppercase tracking-wider">Administratorius:</span>
          <a href="mailto:paulius.barzdonis@mediena.lt"
            className="font-mono text-xs font-bold text-[#6A1107] hover:text-[#441514] underline-offset-2 hover:underline transition-colors truncate">
            paulius.barzdonis@mediena.lt
          </a>
        </div>
      </RuleSection>
    </div>
  );
};

// === GROUPS SCREEN (grupių etapo lentelės) ===

// Apskaičiuoja vienos grupės standings pagal baigtas rungtynes.
// FIFA tiebreakers: taškai → gol skirtumas → įmušti įvarčiai → tarpusavio rungtynės (praleidžiame, retas atvejis)
const calculateStandings = (groupTeams, groupMatches) => {
  const stats = {};
  groupTeams.forEach((code) => {
    stats[code] = { code, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, pts: 0 };
  });

  groupMatches.forEach((m) => {
    if (m.status !== 'finished' || !m.actualScore) return;
    const home = stats[m.home];
    const away = stats[m.away];
    if (!home || !away) return;
    home.P++; away.P++;
    home.GF += m.actualScore.home;
    home.GA += m.actualScore.away;
    away.GF += m.actualScore.away;
    away.GA += m.actualScore.home;
    if (m.actualScore.home > m.actualScore.away) {
      home.W++; home.pts += 3; away.L++;
    } else if (m.actualScore.home < m.actualScore.away) {
      away.W++; away.pts += 3; home.L++;
    } else {
      home.D++; away.D++; home.pts++; away.pts++;
    }
  });

  Object.values(stats).forEach((s) => { s.GD = s.GF - s.GA; });
  return Object.values(stats).sort((a, b) =>
    b.pts - a.pts || b.GD - a.GD || b.GF - a.GF
  );
};

// Spalvos pozicijai: 1-2 vieta - kvalifikuojasi (žalia), 3 vieta - galimai geriausių 8 (geltona), 4 vieta - eliminuotas (pilka)
// Pozicijų spalvos suderintos su brand'u: žalsva (kvalifikuojasi),
// oranžinė-medienos (galimai), tamsiai raudona (eliminuota).
const positionStyle = (pos) => {
  if (pos === 1) return { dot: '#4A6B47', label: 'text-[#4A6B47]' };  // sage green - tvirtai į atkrintamąsias
  if (pos === 2) return { dot: '#4A6B47', label: 'text-[#4A6B47]' };
  if (pos === 3) return { dot: '#C97D3F', label: 'text-[#C97D3F]' };  // terracotta orange - galimai (8 geriausi)
  return { dot: '#6A1107', label: 'text-[#6A1107]' };                 // RUBY - iškrenta
};

const GroupStandingsTable = ({ groupId, teams, matches }) => {
  const standings = useMemo(() => calculateStandings(teams, matches), [teams, matches]);
  const sortedMatches = useMemo(
    () => [...matches].sort((a, b) => (a.kickoff || '').localeCompare(b.kickoff || '')),
    [matches]
  );

  return (
    <div className="card-light rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-lg text-[#441514]">GRUPĖ {groupId}</h3>
        <div className="text-[10px] text-[#845641] uppercase tracking-wider">
          {standings.filter((s) => s.P > 0).length}/{teams.length} žaidė
        </div>
      </div>

      {/* Standings lentelė */}
      <div className="overflow-x-auto -mx-1 px-1 mb-4">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-[#845641] border-b border-[#441514]/10">
              <th className="text-left py-2 w-6">#</th>
              <th className="text-left py-2">Komanda</th>
              <th className="text-center py-2 w-7" title="Žaidžiamos">Ž</th>
              <th className="text-center py-2 w-7" title="Laimėtos">L</th>
              <th className="text-center py-2 w-7" title="Lygiosios">Lg</th>
              <th className="text-center py-2 w-7" title="Pralaimėtos">P</th>
              <th className="text-center py-2 w-10" title="Įvarčių skirtumas">+/-</th>
              <th className="text-center py-2 w-8 font-bold" title="Taškai">Tšk</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s, i) => {
              const pos = i + 1;
              const team = teamsByCode[s.code];
              const style = positionStyle(pos);
              return (
                <tr key={s.code} className="border-b border-[#441514]/5 last:border-0">
                  <td className="py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1 h-4 rounded-full" style={{ backgroundColor: style.dot }} />
                      <span className={`font-mono text-[10px] ${style.label}`}>{pos}</span>
                    </div>
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Flag code={team?.code} className="w-5 h-3.5 flex-shrink-0" />
                      <span className="text-[11px] font-semibold text-[#441514] truncate">
                        {team?.name || s.code}
                      </span>
                    </div>
                  </td>
                  <td className="text-center font-mono text-[#845641]">{s.P}</td>
                  <td className="text-center font-mono text-[#54130E]">{s.W}</td>
                  <td className="text-center font-mono text-[#D1A974]">{s.D}</td>
                  <td className="text-center font-mono text-[#6A1107]">{s.L}</td>
                  <td className="text-center font-mono text-[#441514]">
                    {s.GD > 0 ? `+${s.GD}` : s.GD}
                  </td>
                  <td className="text-center font-mono font-bold text-[#441514]">{s.pts}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Rungtynių sąrašas */}
      <div className="border-t border-[#441514]/10 pt-3">
        <div className="text-[9px] uppercase tracking-wider text-[#845641] mb-2">Rungtynės</div>
        <div className="space-y-1.5">
          {sortedMatches.map((m) => {
            const home = teamsByCode[m.home];
            const away = teamsByCode[m.away];
            const isFinished = m.status === 'finished' && m.actualScore;
            const isLive = m.status === 'live';
            return (
              <div key={m.id} className="flex items-center gap-2 text-[11px]">
                <span className="text-[9px] text-[#845641] w-20 flex-shrink-0">
                  {formatKickoff(m.kickoff).split(' · ')[0]}
                </span>
                <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
                  <span className="text-[#441514] truncate text-right">{home?.name}</span>
                  <Flag code={home?.code} className="w-4 h-3 flex-shrink-0" />
                </div>
                <div className="font-mono text-xs font-bold w-12 text-center flex-shrink-0">
                  {isFinished ? (
                    <span className="text-[#441514]">{m.actualScore.home}:{m.actualScore.away}</span>
                  ) : isLive ? (
                    <span className="text-[#6A1107]">
                      {m.actualScore?.home ?? '−'}:{m.actualScore?.away ?? '−'}
                    </span>
                  ) : (
                    <span className="text-[#A88A6F]">vs</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <Flag code={away?.code} className="w-4 h-3 flex-shrink-0" />
                  <span className="text-[#441514] truncate">{away?.name}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const GroupsScreen = ({ matches }) => {
  // Grupės dinamiškai iš matches: kiekviena grupė turi komandų sąrašą
  const groupsData = useMemo(() => {
    const data = {};
    matches.forEach((m) => {
      if (!m.group || m.stage !== 'group') return;
      if (!data[m.group]) data[m.group] = { teams: new Set(), matches: [] };
      if (m.home) data[m.group].teams.add(m.home);
      if (m.away) data[m.group].teams.add(m.away);
      data[m.group].matches.push(m);
    });
    // Konvertuoti į rūšiuotą array
    return Object.keys(data).sort().map((id) => ({
      id,
      teams: Array.from(data[id].teams),
      matches: data[id].matches,
    }));
  }, [matches]);

  if (groupsData.length === 0) {
    return (
      <div className="space-y-4 pb-24 lg:pb-8">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl text-[#441514] mb-1">GRUPĖS</h1>
          <p className="text-sm text-[#845641]">12 grupių · po 4 komandas</p>
        </div>
        <div className="card-light rounded-xl p-6 text-center">
          <AlertCircle className="w-8 h-8 text-[#D1A974] mx-auto mb-2" />
          <p className="text-sm text-[#441514] font-semibold mb-1">Grupių dar nėra</p>
          <p className="text-xs text-[#845641]">Administratorius dar nesukūrė PFČ 2026 rungtynių.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24 lg:pb-8">
      <div>
        <h1 className="font-display text-3xl lg:text-4xl text-[#441514] mb-1">GRUPĖS</h1>
        <p className="text-sm text-[#845641]">
          {groupsData.length} grupės · po 1-2 vietą kvalifikuojasi tiesiogiai · po 3 vietą — 8 geriausi
        </p>
      </div>

      {/* Legenda */}
      <div className="card-light rounded-xl p-3 flex flex-wrap items-center gap-4 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-3 rounded-full bg-[#4A6B47]" />
          <span className="text-[#441514]">1-2 vieta — į atkrintamąsias</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-3 rounded-full bg-[#C97D3F]" />
          <span className="text-[#441514]">3 vieta — galimai (8 geriausi iš 12)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-3 rounded-full bg-[#6A1107]" />
          <span className="text-[#441514]">4 vieta — eliminuota</span>
        </div>
      </div>

      {/* Grupių lentelės - desktop'e 2-col grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {groupsData.map((g) => (
          <GroupStandingsTable key={g.id} groupId={g.id} teams={g.teams} matches={g.matches} />
        ))}
      </div>
    </div>
  );
};

// === BRACKET SCREEN (knockout vizualizacija) ===

const KNOCKOUT_STAGES = ['round_of_32', 'round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final'];

// Knockout match'ų placeholder'iai - kuri grupė/etapas tiekia komandas į šitą slot'ą.
// Naudojami kai team yra null (komandos dar nepriskirtos). Admin gali bet kada
// rankiniu būdu priskirti tikras komandas per Admin → Rungtynės → Redaguoti.
// PASTABA: tikslus WC 2026 bracket'as gali skirtis - tai geriausias spėjimas pagal
// tipinę 32-team knockout struktūrą (8 geriausi 3 vietos kvalifikuojasi).
const KNOCKOUT_PLACEHOLDERS = {
  // Round of 32 - grupių etapo lyderiai vs runner-up'ai vs 3 vietos geriausi
  k01: { home: '1A', away: '2C' },
  k02: { home: '1C', away: '3 vieta (D/E/F)' },
  k03: { home: '1B', away: '3 vieta (E/F/I/J)' },
  k04: { home: '1F', away: '3 vieta (A/B/C/D)' },
  k05: { home: '1D', away: '2E' },
  k06: { home: '1G', away: '3 vieta (E/H/J/K)' },
  k07: { home: '1J', away: '3 vieta (F/G/L)' },
  k08: { home: '1H', away: '2K' },
  k09: { home: '1E', away: '2L' },
  k10: { home: '1L', away: '3 vieta (A/B/C/F)' },
  k11: { home: '2A', away: '2D' },
  k12: { home: '1K', away: '3 vieta (B/D/I/L)' },
  k13: { home: '2B', away: '2I' },
  k14: { home: '1I', away: '3 vieta (A/C/G/H)' },
  k15: { home: '2F', away: '2G' },
  k16: { home: '2H', away: '2J' },
  // Round of 16 - tiesiog 1/16 nugalėtojai
  k17: { home: '1/16 #1 nug.', away: '1/16 #2 nug.' },
  k18: { home: '1/16 #3 nug.', away: '1/16 #4 nug.' },
  k19: { home: '1/16 #5 nug.', away: '1/16 #6 nug.' },
  k20: { home: '1/16 #7 nug.', away: '1/16 #8 nug.' },
  k21: { home: '1/16 #9 nug.', away: '1/16 #10 nug.' },
  k22: { home: '1/16 #11 nug.', away: '1/16 #12 nug.' },
  k23: { home: '1/16 #13 nug.', away: '1/16 #14 nug.' },
  k24: { home: '1/16 #15 nug.', away: '1/16 #16 nug.' },
  // Quarter finals
  k25: { home: '1/8 #1 nug.', away: '1/8 #2 nug.' },
  k26: { home: '1/8 #3 nug.', away: '1/8 #4 nug.' },
  k27: { home: '1/8 #5 nug.', away: '1/8 #6 nug.' },
  k28: { home: '1/8 #7 nug.', away: '1/8 #8 nug.' },
  // Semi finals
  k29: { home: '¼ #1 nug.', away: '¼ #2 nug.' },
  k30: { home: '¼ #3 nug.', away: '¼ #4 nug.' },
  // 3rd place playoff
  k31: { home: '½ #1 pralaim.', away: '½ #2 pralaim.' },
  // Final
  k32: { home: '½ #1 nug.', away: '½ #2 nug.' },
};

const getPlaceholder = (match, side) => {
  // Pirma bandyti pagal match ID, fallback į "Paaiškės"
  return KNOCKOUT_PLACEHOLDERS[match.id]?.[side] || 'Paaiškės';
};

// Mini match cell bracket'ui (kompaktiškas, su prognozės input'u)
const BracketCell = ({ match, prediction, onUpdatePrediction }) => {
  const isLocked = match.status !== 'upcoming';
  const home = teamsByCode[match.home];
  const away = teamsByCode[match.away];
  const noTeams = !home || !away;

  const [localPred, setLocalPred] = useState({
    home: prediction?.home ?? 0,
    away: prediction?.away ?? 0,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (prediction) setLocalPred({ home: prediction.home, away: prediction.away });
  }, [prediction?.home, prediction?.away]);

  const hasChanges = !prediction
    ? (localPred.home !== 0 || localPred.away !== 0)
    : prediction.home !== localPred.home || prediction.away !== localPred.away;

  let pointsResult = null;
  if (match.status === 'finished' && prediction) {
    pointsResult = calculatePoints(prediction, match.actualScore);
  }

  const handleSave = async () => {
    if (isLocked || !hasChanges || saving || noTeams) return;
    setSaving(true);
    try {
      await onUpdatePrediction(match.id, localPred);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card-light rounded-lg p-2.5 text-xs">
      <div className="text-[9px] text-[#845641] mb-1.5 truncate">{formatKickoff(match.kickoff)}</div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Flag code={home?.code} className="w-5 h-3.5 flex-shrink-0" />
            <span className="text-[11px] font-semibold text-[#441514] truncate">
              {home?.name || <span className="text-[#A88A6F] italic">{getPlaceholder(match, 'home')}</span>}
            </span>
          </div>
          {(match.status === 'finished' || match.status === 'live') && match.actualScore ? (
            <span className="font-mono text-sm font-bold text-[#441514]">{match.actualScore.home}</span>
          ) : !isLocked && !noTeams ? (
            <div className="flex items-center gap-0.5">
              <button onClick={() => setLocalPred({ ...localPred, home: Math.max(0, localPred.home - 1) })}
                className="w-5 h-5 rounded bg-[#441514]/5 text-[#845641] text-xs leading-none">−</button>
              <span className="w-5 text-center font-mono text-xs font-bold text-[#54130E]">{localPred.home}</span>
              <button onClick={() => setLocalPred({ ...localPred, home: Math.min(9, localPred.home + 1) })}
                className="w-5 h-5 rounded bg-[#441514]/5 text-[#845641] text-xs leading-none">+</button>
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Flag code={away?.code} className="w-5 h-3.5 flex-shrink-0" />
            <span className="text-[11px] font-semibold text-[#441514] truncate">
              {away?.name || <span className="text-[#A88A6F] italic">{getPlaceholder(match, 'away')}</span>}
            </span>
          </div>
          {(match.status === 'finished' || match.status === 'live') && match.actualScore ? (
            <span className="font-mono text-sm font-bold text-[#441514]">{match.actualScore.away}</span>
          ) : !isLocked && !noTeams ? (
            <div className="flex items-center gap-0.5">
              <button onClick={() => setLocalPred({ ...localPred, away: Math.max(0, localPred.away - 1) })}
                className="w-5 h-5 rounded bg-[#441514]/5 text-[#845641] text-xs leading-none">−</button>
              <span className="w-5 text-center font-mono text-xs font-bold text-[#54130E]">{localPred.away}</span>
              <button onClick={() => setLocalPred({ ...localPred, away: Math.min(9, localPred.away + 1) })}
                className="w-5 h-5 rounded bg-[#441514]/5 text-[#845641] text-xs leading-none">+</button>
            </div>
          ) : null}
        </div>
      </div>
      {!isLocked && !noTeams && hasChanges && (
        <button onClick={handleSave} disabled={saving}
          style={{ background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)', color: '#ffffff' }}
          className="w-full mt-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider disabled:opacity-50 shadow-md transition-all duration-200 hover:scale-[1.02] hover:brightness-110 hover:shadow-lg active:scale-[0.98] flex items-center justify-center gap-1">
          {saving && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
          Patvirtinti
        </button>
      )}
      {match.status === 'finished' && pointsResult && (
        <div className="mt-1.5 text-center">
          <span className="text-[9px] text-[#845641]">
            Spėjo {prediction ? `${prediction.home}:${prediction.away}` : '−'} ·
          </span>
          <span className="text-[9px] font-bold ml-1" style={{
            color: pointsResult.type === 'exact' ? '#54130E' :
                   pointsResult.type === 'diff' ? '#D1A974' :
                   pointsResult.type === 'outcome' ? '#54130E' : '#A88A6F'
          }}>+{pointsResult.pts} tšk.</span>
        </div>
      )}
      {isLocked && !pointsResult && prediction && (
        <div className="mt-1.5 text-center text-[9px] text-[#845641]">
          Spėjo {prediction.home}:{prediction.away}
        </div>
      )}
    </div>
  );
};

const BracketScreen = ({ matches, predictions, onUpdatePrediction }) => {
  const knockoutMatches = useMemo(() => {
    return matches.filter((m) => m.stage && KNOCKOUT_STAGES.includes(m.stage));
  }, [matches]);

  const byStage = useMemo(() => {
    const groups = {};
    KNOCKOUT_STAGES.forEach((s) => { groups[s] = []; });
    knockoutMatches.forEach((m) => {
      if (groups[m.stage]) groups[m.stage].push(m);
    });
    // Sort each stage by kickoff
    Object.values(groups).forEach((arr) => arr.sort((a, b) => (a.kickoff || '').localeCompare(b.kickoff || '')));
    return groups;
  }, [knockoutMatches]);

  if (knockoutMatches.length === 0) {
    return (
      <div className="space-y-4 pb-24 lg:pb-8">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl text-[#441514] mb-1">ATKRINTAMŲJŲ ETAPAS</h1>
          <p className="text-sm text-[#845641]">1/16 finalas · Aštuntfinalis · ... · Finalas</p>
        </div>
        <div className="card-light rounded-xl p-6 text-center">
          <AlertCircle className="w-8 h-8 text-[#D1A974] mx-auto mb-2" />
          <p className="text-sm text-[#441514] font-semibold mb-1">Atkrintamųjų varžybų etapas dar nesukurtas</p>
          <p className="text-xs text-[#845641]">Administratorius gali sukurti struktūrą administratoriaus skydelyje.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24 lg:pb-8">
      <div>
        <h1 className="font-display text-3xl lg:text-4xl text-[#441514] mb-1">ATKRINTAMŲJŲ ETAPAS</h1>
        <p className="text-sm text-[#845641]">{knockoutMatches.length} rungtynių · spėk visus etapus</p>
      </div>

      {/* Mobile: stack vertically. Desktop: horizontal scroll bracket */}
      <div className="lg:overflow-x-auto lg:scrollbar-hide">
        <div className="space-y-6 lg:space-y-0 lg:flex lg:gap-4 lg:min-w-max">
          {KNOCKOUT_STAGES.map((stage) => {
            const stageMatches = byStage[stage];
            if (!stageMatches || stageMatches.length === 0) return null;
            return (
              <div key={stage} className="lg:w-64 lg:flex-shrink-0">
                <div className="font-display text-xs uppercase tracking-wider text-[#54130E] mb-3 px-1">
                  {STAGE_LABELS[stage]}
                </div>
                <div className="space-y-2 lg:flex lg:flex-col lg:justify-around lg:h-full">
                  {stageMatches.map((m) => (
                    <BracketCell key={m.id} match={m} prediction={predictions[m.id]} onUpdatePrediction={onUpdatePrediction} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// === ADMIN: ĮMONIŲ VALDYMAS ===

const AdminCompaniesPanel = ({ companies, users }) => {
  const { confirm, notify, dialog } = useDialog();
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [busy, setBusy] = useState(false);

  // Skaičiuoti dalyvius kiekvienai įmonei
  const userCounts = useMemo(() => {
    const counts = {};
    users.forEach((u) => {
      if (u.companyId) counts[u.companyId] = (counts[u.companyId] || 0) + 1;
    });
    return counts;
  }, [users]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await createCompany(newName, newCode);
      setNewName('');
      setNewCode('');
    } catch (err) {
      await notify({ title: 'Klaida', message: err.message, variant: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editName.trim()) return;
    setBusy(true);
    try {
      await updateCompany(editingId, editName, editCode);
      setEditingId(null);
      setEditName('');
      setEditCode('');
    } catch (err) {
      await notify({ title: 'Klaida', message: err.message, variant: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (company) => {
    const count = userCounts[company.id] || 0;
    if (count > 0) {
      await notify({
        title: 'Negalima ištrinti',
        message: `Įmonė "${company.name}" turi ${count} ${pluralizeLt(count, ['dalyvį', 'dalyvius', 'dalyvių'])}. Pirma perskirk juos kitur.`,
        variant: 'danger',
      });
      return;
    }
    const ok = await confirm({
      title: 'Ištrinti įmonę',
      message: `Bus ištrinta įmonė "${company.name}". Veiksmas negrįžtamas.`,
      confirmLabel: 'Ištrinti',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteCompany(company.id);
    } catch (err) {
      await notify({ title: 'Klaida', message: err.message, variant: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Pridėti naują */}
      <div className="card-light rounded-xl p-4">
        <div className="font-display text-sm uppercase tracking-wider text-[#441514] mb-3">Nauja įmonė</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Pilnas pavadinimas, pvz., Vakarų Medienos Grupė"
            disabled={busy}
            className="flex-1 px-3 py-2 rounded-lg bg-[#FFFFFF] border border-[#441514]/10 text-sm focus:outline-none focus:border-[#54130E]/50 disabled:opacity-50" />
          <input
            type="text"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value.toUpperCase().slice(0, 6))}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Trumpinys (VMG)"
            disabled={busy}
            maxLength={6}
            className="sm:w-32 px-3 py-2 rounded-lg bg-[#FFFFFF] border border-[#441514]/10 text-sm font-mono uppercase focus:outline-none focus:border-[#54130E]/50 disabled:opacity-50" />
          <button
            onClick={handleCreate}
            disabled={busy || !newName.trim()}
            style={{ background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)', color: '#ffffff' }}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider disabled:opacity-50 shadow-md transition-all duration-200 hover:scale-[1.02] hover:brightness-110 hover:shadow-lg active:scale-[0.98] flex items-center justify-center gap-1 whitespace-nowrap">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <Plus className="w-3.5 h-3.5" /> Pridėti
          </button>
        </div>
        <p className="text-[10px] text-[#845641] mt-2">
          Trumpinys (max 6 simbolių, automatiškai didžiosiomis) rodomas ikonose. Jei nepateiksi - bus naudojama pirma pavadinimo raidė.
        </p>
      </div>

      {/* Sąrašas */}
      {companies.length === 0 ? (
        <div className="card-light rounded-xl p-5 text-center">
          <p className="text-sm text-[#845641]">Įmonių dar nėra. Pridėk pirmąją virš.</p>
        </div>
      ) : (
        <div className="card-light rounded-xl overflow-hidden">
          {companies.map((c) => {
            const count = userCounts[c.id] || 0;
            const isEditing = editingId === c.id;
            const abbrev = companyAbbreviation(c);
            // Ikona platesnė jei trumpinys >2 simbolių (kad tilptų)
            const iconClass = abbrev.length > 2
              ? 'w-auto min-w-[44px] px-2 h-9 text-xs'
              : 'w-9 h-9 text-sm';
            return (
              <div key={c.id} className="flex items-center gap-3 p-3 border-b border-[#441514]/8 last:border-0">
                <div className={`${iconClass} rounded-lg flex items-center justify-center font-display bg-[#54130E]/10 text-[#54130E] flex-shrink-0 font-mono tracking-tight`}>
                  {abbrev}
                </div>
                {isEditing ? (
                  <div className="flex-1 flex flex-col sm:flex-row gap-2 min-w-0">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                      autoFocus
                      disabled={busy}
                      placeholder="Pavadinimas"
                      className="flex-1 px-3 py-1.5 rounded border border-[#54130E]/40 text-sm focus:outline-none focus:border-[#54130E]" />
                    <input
                      type="text"
                      value={editCode}
                      onChange={(e) => setEditCode(e.target.value.toUpperCase().slice(0, 6))}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                      disabled={busy}
                      maxLength={6}
                      placeholder="Trumpinys"
                      className="sm:w-28 px-3 py-1.5 rounded border border-[#54130E]/40 text-sm font-mono uppercase focus:outline-none focus:border-[#54130E]" />
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[#441514] truncate">{c.name}</div>
                    <div className="text-[10px] text-[#845641]">
                      {c.code ? <span className="font-mono text-[#54130E]">{c.code}</span> : <span className="opacity-60 italic">be trumpinio</span>}
                      {' · '}
                      {count} {pluralizeLt(count, ['dalyvis', 'dalyviai', 'dalyvių'])}
                    </div>
                  </div>
                )}
                {isEditing ? (
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={handleSaveEdit} disabled={busy || !editName.trim()}
                      style={{ background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)', color: '#ffffff' }}
                      className="px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider shadow-sm transition-all duration-200 hover:scale-[1.03] hover:brightness-110 active:scale-[0.97] disabled:opacity-50">
                      Saugoti
                    </button>
                    <button onClick={() => { setEditingId(null); setEditName(''); setEditCode(''); }}
                      className="px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider bg-white border border-[#441514]/15">
                      Atš.
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => { setEditingId(c.id); setEditName(c.name); setEditCode(c.code || ''); }}
                      className="px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider text-[#54130E] hover:bg-[#54130E]/5">
                      Keisti
                    </button>
                    <button onClick={() => handleDelete(c)} disabled={busy}
                      className="px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider text-[#6A1107] hover:bg-[#6A1107]/5 disabled:opacity-50">
                      Trinti
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {dialog}
    </div>
  );
};

// === ADMIN: VARTOTOJŲ VALDYMAS ===

const AdminUsersPanel = ({ users, companies, currentUid }) => {
  const { confirm, notify, dialog } = useDialog();
  const [busyUid, setBusyUid] = useState(null);
  const [search, setSearch] = useState('');
  const [privateMap, setPrivateMap] = useState({});
  const [migrating, setMigrating] = useState(false);

  // Listen to users_private (admin'as turi access pagal Firestore Rules)
  useEffect(() => {
    return listenToUsersPrivate(setPrivateMap);
  }, []);

  // Sujungti public + private vartotojų duomenis
  const usersWithPrivate = useMemo(() =>
    users.map((u) => ({ ...u, ...(privateMap[u.uid] || {}) })),
    [users, privateMap]
  );

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...usersWithPrivate].sort((a, b) => (a.username || '').localeCompare(b.username || '', 'lt'));
    if (!q) return sorted;
    return sorted.filter(
      (u) =>
        (u.username || '').toLowerCase().includes(q) ||
        (u.fullName || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q)
    );
  }, [usersWithPrivate, search]);

  // Skaičiuoti, kiek vartotojų vis dar turi senos schemos duomenis (email/fullName public dok'e)
  const usersNeedingMigration = useMemo(
    () => users.filter((u) => u.email || u.fullName).length,
    [users]
  );

  const handleMigrate = async () => {
    const ok = await confirm({
      title: 'Perkelti vartotojų privačius duomenis',
      message: `Bus perkelti ${usersNeedingMigration} vartotojų el. paštas ir vardas/pavardė iš viešų dokumentų į privačius (users_private). Po šio veiksmo el. paštą matys tik patys vartotojai ir administratoriai. Veiksmas negrįžtamas.`,
      confirmLabel: 'Migruoti',
    });
    if (!ok) return;
    setMigrating(true);
    try {
      const count = await migrateUsersToPrivateSchema();
      await notify({ title: 'Pavyko', message: `Perkelta ${count} vartotojų. Privatūs duomenys dabar slepiami nuo kitų.` });
    } catch (err) {
      await notify({ title: 'Klaida', message: err.message, variant: 'danger' });
    } finally {
      setMigrating(false);
    }
  };

  const handleToggleAdmin = async (user) => {
    const willBeAdmin = !user.isAdmin;
    if (user.uid === currentUid && !willBeAdmin) {
      const ok = await confirm({
        title: 'Atimti sau administratoriaus teises?',
        message: "Po šio veiksmo nebematysi administratoriaus skydelio. Atstatyti gali tik kitas administratorius arba Firebase Console.",
        confirmLabel: 'Atimti',
        variant: 'danger',
      });
      if (!ok) return;
    }
    setBusyUid(user.uid);
    try {
      await setUserAdmin(user.uid, willBeAdmin);
    } catch (err) {
      await notify({ title: 'Klaida', message: err.message, variant: 'danger' });
    } finally {
      setBusyUid(null);
    }
  };

  const handleChangeCompany = async (user, companyId) => {
    setBusyUid(user.uid);
    try {
      if (!companyId) {
        await setUserCompany(user.uid, null, null, null);
      } else {
        const company = companies.find((c) => c.id === companyId);
        await setUserCompany(user.uid, companyId, company?.name || null, company?.code || null);
      }
    } catch (err) {
      await notify({ title: 'Klaida', message: err.message, variant: 'danger' });
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Privatumo migracija - tik jei yra senos schemos vartotojų */}
      {usersNeedingMigration > 0 && (
        <div className="card-light rounded-xl p-4 bg-[#D1A974]/5 border-[#D1A974]/30">
          <div className="flex items-start gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-[#D1A974] flex-shrink-0 mt-0.5" />
            <div className="text-xs text-[#441514]">
              <div className="font-bold mb-1">{usersNeedingMigration} vartotojų turi senos struktūros asmeninius duomenis</div>
              <p className="text-[11px] text-[#845641]">
                Jų el. paštas ir vardas/pavardė yra viešuose dokumentuose ir gali būti matomi kitiems prisijungusiems
                vartotojams per naršyklės įrankius. Paspausk mygtuką, kad perkeltum juos į privačius dokumentus.
              </p>
            </div>
          </div>
          <button onClick={handleMigrate} disabled={migrating}
            style={{ backgroundColor: '#D1A974', color: '#ffffff' }}
            className="w-full py-2 rounded-lg text-xs font-bold uppercase tracking-wider disabled:opacity-50 shadow-md transition-all duration-200 hover:scale-[1.02] hover:brightness-110 hover:shadow-lg active:scale-[0.98] flex items-center justify-center gap-2">
            {migrating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Perkelti privačius duomenis ({usersNeedingMigration})
          </button>
        </div>
      )}

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Ieškoti pagal vardą, el. paštą..."
        className="w-full px-3 py-2 rounded-lg bg-white border border-[#441514]/10 text-sm focus:outline-none focus:border-[#54130E]/50" />

      {filteredUsers.length === 0 ? (
        <div className="card-light rounded-xl p-5 text-center">
          <p className="text-sm text-[#845641]">Vartotojų nerasta</p>
        </div>
      ) : (
        <div className="card-light rounded-xl overflow-hidden">
          {filteredUsers.map((u) => {
            const isBusy = busyUid === u.uid;
            const isMe = u.uid === currentUid;
            return (
              <div key={u.uid} className="p-3 border-b border-[#441514]/8 last:border-0">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center font-display text-sm flex-shrink-0"
                    style={{ backgroundColor: `${u.avatarColor}20`, color: u.avatarColor }}>
                    {u.avatarLetter}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[#441514] truncate">
                      {u.username} {isMe && <span className="text-[10px] text-[#845641]">(tu)</span>}
                    </div>
                    <div className="text-[10px] text-[#845641] truncate">{u.email}</div>
                  </div>
                  {u.isAdmin && (
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#54130E]/10 border border-[#54130E]/30 flex-shrink-0">
                      <Settings className="w-2.5 h-2.5 text-[#54130E]" />
                      <span className="text-[9px] font-bold text-[#54130E] uppercase tracking-wider">Admin</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row gap-2 pl-12">
                  <select
                    value={u.companyId || ''}
                    onChange={(e) => handleChangeCompany(u, e.target.value || null)}
                    disabled={isBusy}
                    className="flex-1 px-2 py-1.5 rounded border border-[#441514]/15 text-xs bg-white disabled:opacity-50">
                    <option value="">Be įmonės</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code ? `${c.code} — ${c.name}` : c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleToggleAdmin(u)}
                    disabled={isBusy}
                    style={u.isAdmin
                      ? { backgroundColor: '#ffffff', color: '#6A1107', border: '1px solid rgba(106, 17, 7, 0.3)' }
                      : { background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)', color: '#ffffff' }}
                    className="px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider disabled:opacity-50 shadow-md transition-all duration-200 hover:scale-[1.02] hover:brightness-110 hover:shadow-lg active:scale-[0.98] flex items-center justify-center gap-1 whitespace-nowrap">
                    {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                    {u.isAdmin ? 'Atimti teises' : 'Suteikti teises'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dialog}
    </div>
  );
};

// === ADMIN: TURNYRO REZULTATAI (čempionas + žaidėjų laimėtojai) ===

const AdminResultsPanel = ({ tournamentResults, matches, allTournamentBets, users }) => {
  const { notify, dialog } = useDialog();
  const [form, setForm] = useState({
    champion: tournamentResults?.champion || '',
    bestPlayer: tournamentResults?.bestPlayer || '',
    topScorer: tournamentResults?.topScorer || '',
    bestGoalkeeper: tournamentResults?.bestGoalkeeper || '',
    bestYoungPlayer: tournamentResults?.bestYoungPlayer || '',
  });
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (tournamentResults) {
      setForm({
        champion: tournamentResults.champion || '',
        bestPlayer: tournamentResults.bestPlayer || '',
        topScorer: tournamentResults.topScorer || '',
        bestGoalkeeper: tournamentResults.bestGoalkeeper || '',
        bestYoungPlayer: tournamentResults.bestYoungPlayer || '',
      });
    }
  }, [tournamentResults?.champion, tournamentResults?.bestPlayer, tournamentResults?.topScorer,
      tournamentResults?.bestGoalkeeper, tournamentResults?.bestYoungPlayer]);

  // Visos dalyvaujančios šalys
  const allCountries = useMemo(() => {
    const codes = new Set();
    matches.forEach((m) => {
      if (m.home) codes.add(m.home);
      if (m.away) codes.add(m.away);
    });
    Object.keys(teamsByCode).forEach((c) => codes.add(c));
    return Array.from(codes)
      .filter((c) => teamsByCode[c])
      .sort((a, b) => (teamsByCode[a]?.name || '').localeCompare(teamsByCode[b]?.name || '', 'lt'));
  }, [matches]);

  // Statistika kiek vartotojų bus apdovanoti kiekvienam laukui (preview admin'ui)
  const winnerCounts = useMemo(() => {
    const counts = { champion: 0, bestPlayer: 0, topScorer: 0, bestGoalkeeper: 0, bestYoungPlayer: 0 };
    if (!form.champion && !form.bestPlayer && !form.topScorer && !form.bestGoalkeeper && !form.bestYoungPlayer) {
      return counts;
    }
    allTournamentBets.forEach((bet) => {
      if (form.champion && bet.champion === form.champion) counts.champion++;
      ['bestPlayer', 'topScorer', 'bestGoalkeeper', 'bestYoungPlayer'].forEach((key) => {
        if (form[key] && bet[key] && normalizeName(bet[key]) === normalizeName(form[key])) {
          counts[key]++;
        }
      });
    });
    return counts;
  }, [allTournamentBets, form]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveTournamentResults(form);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch (err) {
      await notify({ title: 'Klaida', message: err.message, variant: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const fields = [
    { key: 'bestPlayer', label: 'Geriausias žaidėjas', points: 15, color: '#D1A974' },
    { key: 'topScorer', label: 'Daugiausiai įvarčių', points: 15, color: '#54130E' },
    { key: 'bestGoalkeeper', label: 'Geriausias vartininkas', points: 15, color: '#54130E' },
    { key: 'bestYoungPlayer', label: 'Geriausias 21m. ar jaunesnis', points: 15, color: '#6A1107' },
  ];

  return (
    <div className="space-y-3">
      <div className="card-light rounded-xl p-4 bg-[#54130E]/5 border-[#54130E]/20">
        <p className="text-xs text-[#441514]">
          <strong>Pastaba:</strong> įvedus tikrus laimėtojus, visiems dalyviams automatiškai pridedami taškai už atitinkančias prognozes. Vardai lyginami neatsižvelgiant į raidžių registrą ir tarpus. Patikrink vardus prieš įrašydamas.
        </p>
      </div>

      {/* Čempionas */}
      <div className="card-light rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-[#D1A974]" />
            <span className="font-display text-sm uppercase tracking-wider text-[#441514]">Čempionas</span>
          </div>
          <span className="text-[10px] font-bold text-[#D1A974] uppercase tracking-wider">25 tšk.</span>
        </div>
        <select value={form.champion}
          onChange={(e) => setForm({ ...form, champion: e.target.value })}
          className="w-full px-3 py-2 rounded-lg bg-white border border-[#441514]/15 text-sm focus:outline-none focus:border-[#54130E]/50">
          <option value="">— Nenustatyta —</option>
          {allCountries.map((code) => (
            <option key={code} value={code}>{teamsByCode[code].name}</option>
          ))}
        </select>
        {form.champion && (
          <div className="mt-2 text-[10px] text-[#845641]">
            {winnerCounts.champion} {pluralizeLt(winnerCounts.champion, ['dalyvis atspėjo', 'dalyviai atspėjo', 'dalyvių atspėjo'])} → +25 tšk. kiekvienam
          </div>
        )}
      </div>

      {/* Žaidėjų laukai */}
      {fields.map(({ key, label, points, color }) => (
        <div key={key} className="card-light rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="font-display text-sm uppercase tracking-wider text-[#441514]">{label}</span>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>{points} tšk.</span>
          </div>
          <input type="text"
            value={form[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            placeholder="pvz., Lionel Messi"
            className="w-full px-3 py-2 rounded-lg bg-white border border-[#441514]/15 text-sm focus:outline-none focus:border-[#54130E]/50" />
          {form[key] && (
            <div className="mt-2 text-[10px] text-[#845641]">
              {winnerCounts[key]} {pluralizeLt(winnerCounts[key], ['dalyvis atspėjo', 'dalyviai atspėjo', 'dalyvių atspėjo'])} → +{points} tšk. kiekvienam
            </div>
          )}
        </div>
      ))}

      <button onClick={handleSave} disabled={saving || justSaved}
        style={justSaved
          ? { background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)', color: '#ffffff' }
          : { background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)', color: '#ffffff' }}
        className="w-full py-3 rounded-xl font-display uppercase tracking-wider text-xs disabled:opacity-60 shadow-md transition-all duration-200 hover:scale-[1.02] hover:brightness-110 hover:shadow-lg active:scale-[0.98] flex items-center justify-center gap-2">
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        {justSaved && <CheckCircle2 className="w-4 h-4" />}
        {saving ? 'Saugoma...' : justSaved ? 'Išsaugota' : 'Išsaugoti rezultatus'}
      </button>

      {dialog}
    </div>
  );
};

const AdminScreen = ({ matches, users, companies, tournamentResults, allTournamentBets, currentUid, onClose }) => {
  const [tab, setTab] = useState('matches'); // 'matches' | 'companies' | 'users'
  const [seeding, setSeeding] = useState(false);
  const [editingMatch, setEditingMatch] = useState(null);
  const [editForm, setEditForm] = useState({ home: 0, away: 0, status: 'upcoming' });
  const { confirm, notify, dialog } = useDialog();

  const handleSeed = async () => {
    const ok = await confirm({
      title: 'Sukurti testines rungtynes',
      message: 'Bus sukurtos 8 testinės rungtynės. Esami m1-m8 dokumentai bus perrašyti.',
      confirmLabel: 'Sukurti',
    });
    if (!ok) return;
    setSeeding(true);
    try {
      await seedDemoMatches();
      await notify({ title: 'Pavyko', message: 'Testinės rungtynės sukurtos.' });
    } catch (err) {
      await notify({ title: 'Klaida', message: err.message, variant: 'danger' });
    } finally {
      setSeeding(false);
    }
  };

  const handleSeedWC2026 = async () => {
    const ok = await confirm({
      title: 'Įkelti PFČ 2026 rungtynes',
      message: 'Bus sukurtos visos 72 PFČ 2026 grupių etapo rungtynės su tikrais oficialiais duomenimis. Laikai - Lietuvos laiku. Esami g01-g72 dokumentai bus perrašyti.',
      confirmLabel: 'Įkelti',
    });
    if (!ok) return;
    setSeeding(true);
    try {
      const count = await seedWC2026Matches();
      await notify({ title: 'Pavyko', message: `Sukurta ${count} tikrų PFČ 2026 grupių etapo rungtynių!` });
    } catch (err) {
      await notify({ title: 'Klaida', message: err.message, variant: 'danger' });
    } finally {
      setSeeding(false);
    }
  };

  const handleDeleteDemo = async () => {
    const ok = await confirm({
      title: 'Ištrinti testines rungtynes',
      message: 'Bus ištrintos visos 8 testinės rungtynės (m1-m8). Tai nepalies tikrų PFČ 2026 rungtynių (g01-g72).',
      confirmLabel: 'Ištrinti',
      variant: 'danger',
    });
    if (!ok) return;
    setSeeding(true);
    try {
      await deleteDemoMatches();
      await notify({ title: 'Pavyko', message: 'Testinės rungtynės ištrintos.' });
    } catch (err) {
      await notify({ title: 'Klaida', message: err.message, variant: 'danger' });
    } finally {
      setSeeding(false);
    }
  };

  const handleSeedKnockout = async () => {
    const ok = await confirm({
      title: 'Sukurti atkrintamųjų varžybų etapo struktūrą',
      message: 'Bus sukurtos 32 tuščios atkrintamųjų varžybų etapo rungtynės (k01-k32) be priskirtų komandų. Komandas priskirsi rankiniu būdu (per „Redaguoti") po grupių etapo arba jas automatiškai užpildys sinchronizacija iš API. Esami k01-k32 dokumentai bus perrašyti.',
      confirmLabel: 'Sukurti',
    });
    if (!ok) return;
    setSeeding(true);
    try {
      const count = await seedKnockoutStructure();
      await notify({ title: 'Pavyko', message: `Sukurti ${count} atkrintamųjų varžybų rungtynių ruošiniai.` });
    } catch (err) {
      await notify({ title: 'Klaida', message: err.message, variant: 'danger' });
    } finally {
      setSeeding(false);
    }
  };

  const handleSyncFromAPI = async () => {
    setSeeding(true);
    try {
      // Vienkartinė savaiminė migracija - užtikrina, kad seni matches įrašai
      // turėtų kickoffMs lauką (reikalinga Firestore Rules laiko patikrai).
      // Idempotent: praleidžiama matches, kurie jau turi kickoffMs.
      await migrateAddKickoffMs();

      const stats = await syncResultsFromAPI();
      let msg =
        `Iš API: ${stats.total} rungtynių\n` +
        `Suderinta: ${stats.matched}\n` +
        `Atnaujinta: ${stats.updated}\n`;
      if (stats.created > 0) {
        msg += `Sukurta naujų (atkrintamųjų): ${stats.created}\n`;
      }
      msg += `Be pakeitimų: ${stats.skipped}`;
      if (stats.unmatched.length > 0) {
        const shown = stats.unmatched.slice(0, 5).join('\n  • ');
        msg += `\n\nNepriderinta (${stats.unmatched.length}):\n  • ${shown}`;
        if (stats.unmatched.length > 5) msg += `\n  • ... ir dar ${stats.unmatched.length - 5}`;
        msg += `\n\n(Atkrintamųjų etapo rungtynės be komandų — laukia grupių rezultatų)`;
      }
      await notify({ title: 'Sinchronizacija baigta', message: msg });
    } catch (err) {
      await notify({
        title: 'Klaida',
        message: err.message + '\n\nGali tiesiog įvesti rezultatus rankiniu būdu žemiau.',
        variant: 'danger',
      });
    } finally {
      setSeeding(false);
    }
  };

  const handleStartEdit = (match) => {
    setEditingMatch(match.id);
    setEditForm({
      home: match.actualScore?.home || 0,
      away: match.actualScore?.away || 0,
      status: match.status,
      homeTeam: match.home || '',
      awayTeam: match.away || '',
      isKnockout: match.stage && match.stage !== 'group',
    });
  };

  const handleSaveEdit = async () => {
    try {
      const updates = { status: editForm.status };
      if (editForm.status === 'finished' || editForm.status === 'live') {
        updates.actualScore = { home: Number(editForm.home), away: Number(editForm.away) };
      } else {
        updates.actualScore = null;
      }
      // Knockout etapo match'ams - leisti keisti komandas
      if (editForm.isKnockout) {
        updates.home = editForm.homeTeam || null;
        updates.away = editForm.awayTeam || null;
      }
      await updateMatch(editingMatch, updates);
      setEditingMatch(null);
    } catch (err) {
      await notify({ title: 'Klaida', message: err.message, variant: 'danger' });
    }
  };

  const tabs = [
    { id: 'matches', label: 'Rungtynės' },
    { id: 'results', label: 'Rezultatai' },
    { id: 'companies', label: 'Įmonės' },
    { id: 'users', label: 'Vartotojai' },
  ];

  const tabSubtitle = {
    matches: 'Rungtynių valdymas',
    results: 'Turnyro laimėtojai (čempionas, žaidėjai)',
    companies: 'Įmonių sąrašas ir dalyvių paskirstymas',
    users: 'Vartotojai, administratoriaus teisės, įmonių keitimas',
  }[tab];

  return (
    <div className="space-y-4 pb-24 lg:pb-8">
      <div className="flex items-center gap-3">
        <button onClick={onClose} className="text-[#845641] hover:text-[#441514]">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="font-display text-2xl text-[#441514]">ADMIN</h1>
          <p className="text-xs text-[#845641]">{tabSubtitle}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-[#441514]/5">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={tab === t.id ? { backgroundColor: '#ffffff', color: '#441514' } : { color: '#845641' }}
            className="flex-1 py-2 px-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all">
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'results' && <AdminResultsPanel tournamentResults={tournamentResults}
        matches={matches} allTournamentBets={allTournamentBets} users={users} />}
      {tab === 'companies' && <AdminCompaniesPanel companies={companies} users={users} />}
      {tab === 'users' && <AdminUsersPanel users={users} companies={companies} currentUid={currentUid} />}

      {tab === 'matches' && (
        <>
      {/* API sinchronizavimas - svarbiausias mygtukas */}
      <div className="card-light rounded-xl p-4 space-y-3" style={{ borderLeft: '3px solid #54130E' }}>
        <div>
          <div className="font-display text-sm uppercase tracking-wider text-[#441514] mb-1 flex items-center gap-2">
            <Radio className="w-4 h-4 text-[#54130E]" />
            Rezultatų sinchronizacija
          </div>
          <p className="text-[11px] text-[#845641]">Paspausk po kiekvienos rungtynių dienos — automatiškai atnaujins baigtas ar vykstančias rungtynes iš oficialaus FIFA duomenų tiekėjo (football-data.org).</p>
        </div>

        <button onClick={handleSyncFromAPI} disabled={seeding}
          style={{ background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)', color: '#ffffff' }}
          className="w-full py-2.5 rounded-lg font-display uppercase tracking-wider text-xs disabled:opacity-50 shadow-md transition-all duration-200 hover:scale-[1.02] hover:brightness-110 hover:shadow-lg active:scale-[0.98] flex items-center justify-center gap-2">
          {seeding && <Loader2 className="w-4 h-4 animate-spin" />}
          Atnaujinti rezultatus iš API
        </button>

        <p className="text-[10px] text-[#845641]">
          💡 Jei API neveikia, žemiau bet kada gali įvesti rezultatą rankiniu būdu.
        </p>
      </div>

      {/* Setup veiksmai - visada matomi */}
      <div className="card-light rounded-xl p-4 space-y-3">
        <div>
          <div className="font-display text-sm uppercase tracking-wider text-[#441514] mb-1">Rungtynių valdymas</div>
          <p className="text-[11px] text-[#845641]">Tikros oficialios PFČ 2026 rungtynės - 72 grupių etapo rungtynės. Atkrintamųjų varžybų etapas pridedamas rankiniu būdu po grupių.</p>
        </div>

        <button onClick={handleSeedWC2026} disabled={seeding}
          style={{ background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)', color: '#ffffff' }}
          className="w-full py-2.5 rounded-lg font-display uppercase tracking-wider text-xs disabled:opacity-50 shadow-md transition-all duration-200 hover:scale-[1.02] hover:brightness-110 hover:shadow-lg active:scale-[0.98] flex items-center justify-center gap-2">
          {seeding && <Loader2 className="w-4 h-4 animate-spin" />}
          Įkelti PFČ 2026 rungtynes (72)
        </button>

        <button onClick={handleSeedKnockout} disabled={seeding}
          style={{ background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)', color: '#ffffff' }}
          className="w-full py-2.5 rounded-lg font-display uppercase tracking-wider text-xs disabled:opacity-50 shadow-md transition-all duration-200 hover:scale-[1.02] hover:brightness-110 hover:shadow-lg active:scale-[0.98] flex items-center justify-center gap-2">
          {seeding && <Loader2 className="w-4 h-4 animate-spin" />}
          Sukurti atkrintamųjų etapą (32)
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={handleSeed} disabled={seeding}
            style={{ backgroundColor: '#845641', color: '#ffffff' }}
            className="py-2 rounded-lg font-display uppercase tracking-wider text-[10px] disabled:opacity-50 shadow-md transition-all duration-200 hover:scale-[1.02] hover:brightness-110 hover:shadow-lg active:scale-[0.98] flex items-center justify-center gap-1">
            Sukurti 8 testines
          </button>
          <button onClick={handleDeleteDemo} disabled={seeding}
            style={{ backgroundColor: '#6A1107', color: '#ffffff' }}
            className="py-2 rounded-lg font-display uppercase tracking-wider text-[10px] disabled:opacity-50 shadow-md transition-all duration-200 hover:scale-[1.02] hover:brightness-110 hover:shadow-lg active:scale-[0.98] flex items-center justify-center gap-1">
            Ištrinti testines
          </button>
        </div>
      </div>

      {matches.length === 0 && (
        <div className="card-light rounded-xl p-5">
          <p className="text-sm text-[#441514] font-semibold">Nėra rungtynių</p>
          <p className="text-xs text-[#845641] mt-1">Paspausk "Įkelti PFČ 2026 rungtynes" viršuje.</p>
        </div>
      )}

      <div className="space-y-2">
        {matches.map((m) => (
          <div key={m.id} className="card-light rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <Flag code={teamsByCode[m.home]?.code} className="w-6 h-4" />
                <span className="text-xs font-bold truncate">
                  {teamsByCode[m.home]?.name || <span className="text-[#A88A6F]">Paaiškės</span>}
                </span>
                <span className="text-[#A88A6F] text-xs">vs</span>
                <span className="text-xs font-bold truncate">
                  {teamsByCode[m.away]?.name || <span className="text-[#A88A6F]">Paaiškės</span>}
                </span>
                <Flag code={teamsByCode[m.away]?.code} className="w-6 h-4" />
              </div>
              <StatusBadge status={m.status} />
            </div>
            <div className="text-[10px] text-[#845641] mb-2 flex items-center gap-2">
              <span>{formatKickoff(m.kickoff)}</span>
              {m.stage && m.stage !== 'group' && (
                <span className="text-[9px] font-bold text-[#54130E] uppercase tracking-wider">
                  · {STAGE_LABELS[m.stage]}
                </span>
              )}
            </div>

            {editingMatch === m.id ? (
              <div className="space-y-2 pt-2 border-t border-[#441514]/8">
                {editForm.isKnockout && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] font-bold text-[#845641] uppercase tracking-wider block mb-1">Šeimininkai</label>
                      <select value={editForm.homeTeam}
                        onChange={(e) => setEditForm({ ...editForm, homeTeam: e.target.value })}
                        className="w-full px-2 py-1.5 rounded border border-[#441514]/15 text-xs bg-white">
                        <option value="">— Paaiškės —</option>
                        {Object.keys(teamsByCode).sort((a, b) => teamsByCode[a].name.localeCompare(teamsByCode[b].name, 'lt')).map((code) => (
                          <option key={code} value={code}>{teamsByCode[code].name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-[#845641] uppercase tracking-wider block mb-1">Svečiai</label>
                      <select value={editForm.awayTeam}
                        onChange={(e) => setEditForm({ ...editForm, awayTeam: e.target.value })}
                        className="w-full px-2 py-1.5 rounded border border-[#441514]/15 text-xs bg-white">
                        <option value="">— Paaiškės —</option>
                        {Object.keys(teamsByCode).sort((a, b) => teamsByCode[a].name.localeCompare(teamsByCode[b].name, 'lt')).map((code) => (
                          <option key={code} value={code}>{teamsByCode[code].name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2 justify-center">
                  <input type="number" min="0" max="20" value={editForm.home}
                    onChange={(e) => setEditForm({ ...editForm, home: e.target.value })}
                    className="w-16 px-2 py-1.5 rounded border border-[#441514]/15 text-center font-mono" />
                  <span>:</span>
                  <input type="number" min="0" max="20" value={editForm.away}
                    onChange={(e) => setEditForm({ ...editForm, away: e.target.value })}
                    className="w-16 px-2 py-1.5 rounded border border-[#441514]/15 text-center font-mono" />
                </div>
                <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  className="w-full px-2 py-1.5 rounded border border-[#441514]/15 text-sm">
                  <option value="upcoming">Būsima</option>
                  <option value="live">Vyksta tiesiogiai</option>
                  <option value="finished">Baigta</option>
                </select>
                <div className="flex gap-2">
                  <button onClick={handleSaveEdit}
                    style={{ background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)', color: '#ffffff' }}
                    className="flex-1 py-1.5 rounded text-xs font-bold uppercase tracking-wider">
                    Išsaugoti
                  </button>
                  <button onClick={() => setEditingMatch(null)}
                    className="flex-1 py-1.5 rounded text-xs font-bold uppercase tracking-wider bg-white border border-[#441514]/15">
                    Atšaukti
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between pt-2 border-t border-[#441514]/8">
                {m.actualScore && (
                  <span className="font-mono text-sm font-bold">
                    Rez: {m.actualScore.home}:{m.actualScore.away}
                  </span>
                )}
                <button onClick={() => handleStartEdit(m)}
                  className="ml-auto text-xs font-bold text-[#54130E] uppercase tracking-wider">
                  Redaguoti →
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="card-light rounded-xl p-4 bg-[#D1A974]/5 border-[#D1A974]/30">
        <p className="text-xs text-[#441514]">
          <strong>Pastaba:</strong> Pakeitus rungtynių rezultatą į "Baigta", visų vartotojų taškai automatiškai perskaičiuojami pagal jų prognozes.
        </p>
      </div>
        </>
      )}

      {dialog}
    </div>
  );
};

// ============================================================
// PRIVATUMO POLITIKOS SUTIKIMO GATE (re-consent seniems vartotojams)
// ============================================================
// Pirmas blokuojantis ekranas po prisijungimo, jei vartotojas dar nesutiko
// su dabartine politikos versija. Du veiksmai: Sutinku arba Ištrinti paskyrą.
// Be sutikimo - į totalizatorių neįleidžia.

const PolicyConsentGate = ({ userProfile, onAccepted, onLogout }) => {
  const { confirm, notify, dialog } = useDialog();
  const [submitting, setSubmitting] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [showDeleteForm, setShowDeleteForm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleAccept = async () => {
    if (!agreed || submitting) return;
    setSubmitting(true);
    try {
      await acceptPolicyConsent();
      onAccepted();
    } catch (err) {
      await notify({
        title: 'Klaida išsaugant sutikimą',
        message: err.message || 'Nepavyko išsaugoti sutikimo. Bandyk dar kartą.',
        variant: 'danger',
      });
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deletePassword) {
      await notify({ title: 'Klaida', message: 'Įvesk slaptažodį patvirtinimui', variant: 'danger' });
      return;
    }
    const ok = await confirm({
      title: 'Ar tikrai ištrinti paskyrą?',
      message: 'Visi tavo duomenys bus negrįžtamai pašalinti. Šio veiksmo atšaukti negalima.',
      confirmLabel: 'Taip, ištrinti',
      variant: 'danger',
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteUserAccount(deletePassword);
      // Po sėkmingo ištrynimo Firebase auto-signs out
    } catch (err) {
      await notify({
        title: 'Klaida ištrinant paskyrą',
        message: err.message || 'Nepavyko ištrinti.',
        variant: 'danger',
      });
      setDeleting(false);
    }
  };

  return (
    <div className="app-bg font-body text-[#441514] min-h-screen flex items-center justify-center p-4">
      <Styles />
      <div className="w-full max-w-lg card-light rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#441514]/8">
          <Lock className="w-5 h-5 text-[#54130E]" />
          <h2 className="font-display text-lg uppercase tracking-wider text-[#441514]">Privatumo politika</h2>
        </div>

        <p className="text-sm text-[#441514] leading-relaxed mb-3">
          Sveikas, <strong>{userProfile.username}</strong>! Atnaujinome PFČ 2026 totalizatoriaus privatumo politiką.
          Prieš tęsiant, prašome susipažinti ir patvirtinti sutikimą.
        </p>

        <div className="rounded-lg bg-[#FAF0E0] border border-[#D1A974]/40 p-3 mb-4 max-h-56 overflow-y-auto text-xs text-[#441514] leading-relaxed space-y-2">
          <div>
            <strong>Duomenų valdytojas:</strong>{' '}
            <a href="mailto:paulius.barzdonis@mediena.lt" className="font-mono text-[#6A1107]">
              paulius.barzdonis@mediena.lt
            </a>
          </div>
          <div>
            <strong>Kokie duomenys renkami:</strong> el. paštas, slaptažodis (bcrypt hash), vardas/pavardė
            (matomas tik tau ir admin'ui), vartotojo vardas, įmonė, prognozės, taškai.
          </div>
          <div>
            <strong>Trečiosios šalys:</strong> Google Firebase (ES datacenter'iai, GDPR DPA), Netlify (hosting),
            Google reCAPTCHA + Fonts.
          </div>
          <div>
            <strong>Tavo teisės:</strong> prieiti, taisyti, ištrinti savo duomenis (Profile ekrane).
          </div>
          <div>
            <strong>Saugojimas:</strong> iki turnyro pabaigos + 30 dienų. Tada PII anonimizuojama.
          </div>
          <div className="text-[10px] text-[#845641] pt-1 border-t border-[#D1A974]/30">
            Pilną politiką galėsi pamatyti Taisyklių skiltyje po sutikimo.
          </div>
        </div>

        {!showDeleteForm ? (
          <>
            <label className="flex items-start gap-2 cursor-pointer mb-4">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                disabled={submitting}
                className="mt-0.5 w-4 h-4 accent-[#54130E] flex-shrink-0"
              />
              <span className="text-xs text-[#441514] leading-relaxed">
                Susipažinau ir sutinku su <strong>PFČ 2026 totalizatoriaus privatumo politika</strong> ir mano
                asmens duomenų tvarkymu nurodytais tikslais.
              </span>
            </label>

            <button
              onClick={handleAccept}
              disabled={!agreed || submitting}
              style={{
                background: agreed && !submitting ? 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)' : '#A88A6F',
                color: '#ffffff',
              }}
              className="w-full py-3 rounded-xl font-display uppercase tracking-wider shadow-md transition-all duration-200 hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2 mb-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? 'Saugoma...' : 'Sutinku ir tęsiu'}
            </button>

            <button
              onClick={() => setShowDeleteForm(true)}
              disabled={submitting}
              className="w-full py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider text-[#54130E] hover:bg-[#54130E]/5 transition-colors"
            >
              Nesutinku — ištrinti paskyrą
            </button>
          </>
        ) : (
          <div className="space-y-3 pt-2 border-t border-[#54130E]/15">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-[#54130E] flex-shrink-0 mt-0.5" />
              <p className="text-xs text-[#845641] leading-relaxed">
                Jei nesutinki su politika — tavo paskyra ir VISI duomenys bus negrįžtamai ištrinti.
                Patvirtink slaptažodžiu.
              </p>
            </div>
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={deleting}
              className="w-full px-3 py-2 rounded-lg bg-[#FFFFFF] border border-[#54130E]/30 text-sm focus:outline-none focus:border-[#54130E] focus:ring-2 focus:ring-[#54130E]/15"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setShowDeleteForm(false); setDeletePassword(''); }}
                disabled={deleting}
                style={{ backgroundColor: '#FFFFFF', color: '#845641', border: '1px solid rgba(132, 86, 65, 0.3)' }}
                className="flex-1 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider hover:bg-[#FAF0E0] disabled:opacity-50"
              >
                Atšaukti
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting || !deletePassword}
                style={{ backgroundColor: '#54130E', color: '#FFFFFF' }}
                className="flex-1 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {deleting ? 'Trinama...' : 'Ištrinti'}
              </button>
            </div>
            <button
              onClick={onLogout}
              disabled={deleting}
              className="w-full py-2 text-[10px] uppercase tracking-wider text-[#845641] hover:text-[#54130E] transition-colors"
            >
              Atsijungti ir nuspręsti vėliau
            </button>
          </div>
        )}
      </div>
      {dialog}
    </div>
  );
};

// ============================================================
// MAIN APP
// ============================================================

export default function App() {
  const { notify, dialog } = useDialog();
  // Auth state
  const [authUser, setAuthUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authMode, setAuthMode] = useState('login');

  // App state
  const [screen, setScreen] = useState('home');
  const [matches, setMatches] = useState([]);
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [predictions, setPredictions] = useState({});
  const [allPredictions, setAllPredictions] = useState([]);
  const [allTournamentBets, setAllTournamentBets] = useState([]);
  const [tournamentResults, setTournamentResults] = useState(null);
  const [tournamentBet, setTournamentBet] = useState({
    champion: null,
    bestPlayer: '',
    topScorer: '',
    bestGoalkeeper: '',
    bestYoungPlayer: '',
  });
  // Vienkartinis lyderlentės pataisymo pranešimas (žr. LeaderboardFixAnnouncement).
  const [showLeaderboardAnnouncement, setShowLeaderboardAnnouncement] = useState(false);

  // Listen to auth state
  useEffect(() => {
    return onAuthChange(async (user) => {
      setAuthUser(user);
      if (user) {
        try {
          // RETRY profilio krovimo - apsauga nuo race condition tarp
          // createUserWithEmailAndPassword (kuri auto-triggerina onAuthChange)
          // ir registerUser Firestore dokumentų sukūrimo. Naujam vartotojui
          // profile gali dar neegzistuoti pirmą bandymą - retry per ~3 sek.
          let profile = null;
          const delays = [0, 400, 800, 1200, 1600]; // iš viso ~4 sek
          for (const d of delays) {
            if (d > 0) await new Promise((r) => setTimeout(r, d));
            try {
              profile = await getUserProfile(user.uid);
            } catch (_) {}
            if (profile) break;
          }
          setUserProfile(profile);
          if (profile) {
            try {
              const bet = await getTournamentBet(user.uid);
              if (bet) setTournamentBet({
                champion: bet.champion || null,
                bestPlayer: bet.bestPlayer || '',
                topScorer: bet.topScorer || '',
                bestGoalkeeper: bet.bestGoalkeeper || '',
                bestYoungPlayer: bet.bestYoungPlayer || '',
              });
            } catch (_) {}
          }
        } catch (err) {
          console.error('Failed to load profile:', err);
        }
      } else {
        setUserProfile(null);
      }
      setAuthChecking(false);
    });
  }, []);

  // Listen to data when authenticated
  // listenToFinishedPredictions filtruoja per `where('revealed', '==', true)` —
  // tai vienintelis būdas patenkinti Firestore Rules query'iams. Cron'as
  // (netlify/functions/sync-results-cron.js) set'ina revealed=true kai match
  // pereina iš 'upcoming' į 'live'/'finished'.
  useEffect(() => {
    if (!authUser) return;
    const unsubs = [
      listenToMatches(setMatches),
      listenToUserPredictions(authUser.uid, setPredictions),
      listenToFinishedPredictions(setAllPredictions),
      listenToUsers(setUsers),
      listenToAllTournamentBets(setAllTournamentBets),
      listenToTournamentResults(setTournamentResults),
    ];
    return () => unsubs.forEach((u) => u());
  }, [authUser]);

  // Companies - subscribe visada (reikalinga registracijos formai prieš auth)
  useEffect(() => {
    return listenToCompanies(setCompanies);
  }, []);

  // Vienkartinis pranešimas apie lyderlentės pataisymą - rodyti tik užkrovus profilį,
  // jei (a) terminas dar nepasibaigė, (b) localStorage flag'as dar nenustatytas.
  useEffect(() => {
    if (!userProfile) return;
    if (Date.now() > ANNOUNCEMENT_EXPIRY_MS) return;
    try {
      const seen = localStorage.getItem(`seen_${ANNOUNCEMENT_ID}`);
      if (!seen) setShowLeaderboardAnnouncement(true);
    } catch (_) {
      // localStorage neprieinama (private mode + lockdown) - praleisti
    }
  }, [userProfile?.uid]);

  const dismissLeaderboardAnnouncement = () => {
    try {
      localStorage.setItem(`seen_${ANNOUNCEMENT_ID}`, '1');
    } catch (_) {}
    setShowLeaderboardAnnouncement(false);
  };

  // Calculate points for all users (match prognosis + tournament prognosis)
  const usersWithPoints = useMemo(() => {
    return users.map((u) => {
      const userPreds = allPredictions.filter((p) => p.userId === u.uid);
      let matchPoints = 0;
      let streak = 0;
      let streakBroken = false;
      // Rūšiuoti pagal kickoff (naujausi paskutiniai), kad streak skaičiuotų teisingai
      const sortedPreds = userPreds.map((pred) => {
        const match = matches.find((m) => m.id === pred.matchId);
        return { pred, match };
      }).filter((x) => x.match && x.match.status === 'finished' && x.match.actualScore)
        .sort((a, b) => (b.match.kickoff || '').localeCompare(a.match.kickoff || ''));

      sortedPreds.forEach(({ pred, match }) => {
        const result = calculatePoints({ home: pred.home, away: pred.away }, match.actualScore);
        matchPoints += result.pts;
        if (!streakBroken) {
          if (result.pts > 0) streak++;
          else streakBroken = true;
        }
      });

      // Turnyro prognozės taškai (čempionas + 4 žaidėjų kategorijos)
      const userBet = allTournamentBets.find((b) => b.userId === u.uid);
      const tournamentPts = calculateTournamentPoints(userBet, tournamentResults);

      return {
        ...u,
        points: matchPoints + tournamentPts.total,
        matchPoints,
        tournamentPoints: tournamentPts.total,
        tournamentBreakdown: tournamentPts,
        streak,
      };
    });
  }, [users, allPredictions, matches, allTournamentBets, tournamentResults]);

  // Handlers
  const handleUpdatePrediction = async (matchId, value) => {
    if (!authUser) return;
    try {
      await savePrediction(authUser.uid, matchId, value.home, value.away);
    } catch (err) {
      console.error('Save prediction failed:', err);
      await notify({
        title: 'Nepavyko išsaugoti',
        message: 'Patikrink ar rungtynės dar neprasidėjo.',
        variant: 'danger',
      });
    }
  };

  const handleLogout = async () => {
    await logoutUser();
    setScreen('home');
    setAuthMode('login');
  };

  // Loading
  if (authChecking) return <LoadingScreen />;

  // Not authenticated
  if (!authUser || !userProfile) {
    if (authMode === 'register') {
      return <RegisterScreen companies={companies} onSwitchToLogin={() => setAuthMode('login')} />;
    }
    return <LoginScreen onSwitchToRegister={() => setAuthMode('register')} />;
  }

  // RE-CONSENT GATE: vartotojas dar nesutiko su dabartine privatumo politika.
  // Tikslo - apima ir senus (be policyConsent) ir tuos, kurie sutiko su senesne versija.
  const needsConsent =
    !userProfile.policyConsent ||
    userProfile.policyConsent.version !== CURRENT_POLICY_VERSION;

  if (needsConsent) {
    return (
      <PolicyConsentGate
        userProfile={userProfile}
        onAccepted={() => setUserProfile((p) => ({
          ...p,
          policyConsent: { version: CURRENT_POLICY_VERSION, acceptedAt: new Date() },
        }))}
        onLogout={handleLogout}
      />
    );
  }

  // Admin screen (modal-like full screen)
  if (screen === 'admin') {
    return (
      <div className="app-bg font-body text-[#441514]">
        <Styles />
        <div className="max-w-md lg:max-w-4xl mx-auto min-h-screen px-4 pt-4">
          <AdminScreen
            matches={matches}
            users={users}
            companies={companies}
            tournamentResults={tournamentResults}
            allTournamentBets={allTournamentBets}
            currentUid={authUser.uid}
            onClose={() => setScreen('profile')} />
        </div>
        {dialog}
      </div>
    );
  }

  // Authenticated main app
  const navItems = [
    { id: 'home', icon: Home, label: 'Pradžia' },
    { id: 'matches', icon: Calendar, label: 'Rungtynės' },
    { id: 'groups', icon: Shield, label: 'Grupės' },
    { id: 'bracket', icon: Award, label: 'Atkrintamosios' },
    { id: 'tournament', icon: Trophy, label: 'Prognozės' },
    { id: 'leaderboard', icon: BarChart3, label: 'Statistika' },
    { id: 'rules', icon: BookOpen, label: 'Taisyklės' },
  ];

  return (
    <div className="app-bg font-body text-[#441514]">
      <Styles />
      <div className="max-w-md lg:max-w-6xl xl:max-w-7xl mx-auto min-h-screen flex flex-col">
        <header className="sticky top-0 z-40 px-4 py-3 flex items-center justify-between gap-4 shadow-md"
          style={{ background: 'linear-gradient(135deg, #9A6B52 0%, #845641 50%, #5C3E2E 100%)' }}>
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <Emblem className="w-10 h-10" variant="dark" />
            <div>
              <div className="font-display text-sm text-white leading-none tracking-wide">PFČ 2026</div>
              <div className="text-[9px] uppercase tracking-widest mt-0.5" style={{ color: '#D1A974' }}>Totalizatorius</div>
            </div>
          </div>

          {/* Desktop: tabs viduryje header'io. Kompaktiškas padding, kad tilptų visi 7 punktai.
              Mažesniam lg (1024-1279) ikonos pridėtos tik xl+ ekranams, kad sutaupyti vietos. */}
          <nav className="hidden lg:flex flex-1 justify-center gap-0.5 overflow-x-auto scrollbar-hide">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = screen === item.id;
              return (
                <button key={item.id} onClick={() => setScreen(item.id)}
                  className={`flex items-center gap-1.5 px-2.5 xl:px-3 py-2 rounded-lg flex-shrink-0 transition-all duration-200 hover:scale-[1.03] ${
                    active
                      ? 'bg-white/15 text-white shadow-inner'
                      : 'text-white/80 hover:text-white hover:bg-white/10'
                  }`}>
                  <Icon className="hidden xl:inline-block w-4 h-4 flex-shrink-0" />
                  <span className="text-[11px] xl:text-xs font-bold uppercase tracking-wider whitespace-nowrap">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <button onClick={() => setScreen('profile')}
            className="w-10 h-10 rounded-full flex items-center justify-center font-display text-sm transition-all duration-200 hover:scale-110 bg-white shadow-md flex-shrink-0"
            style={{ color: userProfile.avatarColor, border: `2px solid #D1A974` }}>
            {userProfile.avatarLetter}
          </button>
        </header>

        <main className="flex-1 px-4 pt-4">
          {screen === 'home' && <HomeScreen userProfile={userProfile} usersWithPoints={usersWithPoints}
            matches={matches} predictions={predictions} setScreen={setScreen} onUpdatePrediction={handleUpdatePrediction} />}
          {screen === 'matches' && <MatchesScreen matches={matches} predictions={predictions}
            onUpdatePrediction={handleUpdatePrediction} />}
          {screen === 'groups' && <GroupsScreen matches={matches} />}
          {screen === 'bracket' && <BracketScreen matches={matches} predictions={predictions}
            onUpdatePrediction={handleUpdatePrediction} />}
          {screen === 'rules' && <RulesScreen />}
          {screen === 'tournament' && <TournamentScreen userProfile={userProfile} matches={matches}
            tournamentBet={tournamentBet} setTournamentBet={setTournamentBet} />}
          {screen === 'leaderboard' && <LeaderboardScreen usersWithPoints={usersWithPoints}
            userProfile={userProfile} />}
          {screen === 'profile' && <ProfileScreen userProfile={userProfile} usersWithPoints={usersWithPoints}
            matches={matches} predictions={predictions} tournamentResults={tournamentResults}
            onLogout={handleLogout} onOpenAdmin={() => setScreen('admin')}
            onProfileUpdated={(patch) => setUserProfile((p) => ({ ...p, ...patch }))} />}
        </main>

        {/* Mobile bottom nav - horizontaliai slenkantis su didesniais mygtukais.
            Desktop'e paslėpta (header'io tabs naudojami). */}
        <nav className="fixed bottom-0 left-0 right-0 z-30 lg:hidden shadow-[0_-4px_12px_rgba(68,21,20,0.08)]"
          style={{ background: 'linear-gradient(180deg, #FFFFFF 0%, #FAF6EF 100%)', borderTop: '1px solid rgba(132, 86, 65, 0.15)' }}>
          <div className="flex overflow-x-auto scrollbar-hide px-2 py-2 gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = screen === item.id;
              return (
                <button key={item.id} onClick={() => setScreen(item.id)}
                  style={active ? { background: 'linear-gradient(135deg, #9A6B52 0%, #5C3E2E 100%)', color: '#FFFFFF' } : {}}
                  className={`flex flex-col items-center justify-center gap-1 min-w-[72px] flex-shrink-0 px-3 py-2 rounded-xl transition-all duration-200 hover:scale-[1.05] active:scale-[0.95] ${
                    active ? 'shadow-md' : 'text-[#845641] hover:text-[#441514] hover:bg-[#845641]/10'
                  }`}>
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  <span className="text-[10px] font-bold uppercase tracking-wide leading-tight text-center whitespace-nowrap">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
      {dialog}
      {showLeaderboardAnnouncement && (
        <LeaderboardFixAnnouncement onDismiss={dismissLeaderboardAnnouncement} />
      )}
    </div>
  );
}
