import { useState, useEffect, useMemo } from 'react';
import {
  Trophy, Home, Calendar, BarChart3, Lock, Settings,
  Award, Crown, Target, Star, Flame, Plus, Minus, Shield,
  ChevronRight, ChevronLeft, Radio, LogOut, Loader2,
  AlertCircle, CheckCircle2,
} from 'lucide-react';
import {
  registerUser, loginUser, logoutUser, onAuthChange,
  getUserProfile, savePrediction, saveTournamentBet, getTournamentBet,
  listenToMatches, listenToUserPredictions, listenToAllPredictions, listenToUsers, listenToCompanies,
  listenToAllTournamentBets, listenToTournamentResults, saveTournamentResults,
  updateMatch, seedDemoMatches, seedWC2026Matches, deleteDemoMatches, syncResultsFromAPI,
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
    'auth/weak-password': 'Per silpnas slaptažodis (bent 6 simboliai)',
    'auth/user-not-found': 'Toks vartotojas nerastas',
    'auth/wrong-password': 'Neteisingas slaptažodis',
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
    .font-display { font-family: 'Archivo Black', sans-serif; letter-spacing: -0.02em; }
    .font-body { font-family: 'Plus Jakarta Sans', sans-serif; }
    .font-mono { font-family: 'JetBrains Mono', monospace; }

    .app-bg {
      background:
        radial-gradient(circle at 0% 0%, rgba(14, 107, 71, 0.05) 0%, transparent 40%),
        radial-gradient(circle at 100% 100%, rgba(184, 134, 11, 0.04) 0%, transparent 40%),
        #faf7f1;
      min-height: 100vh;
    }

    .glass-light {
      background: rgba(250, 247, 241, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid rgba(20, 17, 13, 0.08);
    }

    .card-light {
      background: #ffffff;
      border: 1px solid rgba(20, 17, 13, 0.08);
      box-shadow: 0 1px 2px rgba(20, 17, 13, 0.03), 0 4px 12px rgba(20, 17, 13, 0.04);
    }

    .flag-img {
      border-radius: 3px;
      box-shadow: 0 1px 2px rgba(20, 17, 13, 0.15);
      outline: 1px solid rgba(20, 17, 13, 0.08);
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
      opacity: 0.04;
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
      <div className={`${className} bg-[#1a1410]/10 rounded-sm flex items-center justify-center`}>
        <span className="text-[8px] font-bold uppercase text-[#6b6359]">?</span>
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

const Emblem = ({ className = 'w-16 h-16', variant = 'dark' }) => {
  const isDark = variant === 'dark';
  const colors = isDark
    ? { bg: '#0a2c4e', border: '#c9a961', text: '#faf7f1', ball: '#faf7f1', ballPattern: '#0a2c4e' }
    : { bg: '#faf7f1', border: '#0a2c4e', text: '#0a2c4e', ball: '#0a2c4e', ballPattern: '#faf7f1' };

  return (
    <svg viewBox="0 0 100 100" className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="48" fill={colors.bg} stroke={colors.border} strokeWidth="1.5"/>
      <circle cx="50" cy="50" r="43" fill="none" stroke={colors.border} strokeWidth="0.5" opacity="0.5"/>
      <g transform="translate(50, 38)">
        <circle r="11" fill={colors.ball}/>
        <polygon points="0,-5 5,-1.5 3,4.5 -3,4.5 -5,-1.5" fill={colors.ballPattern}/>
        <path d="M0,-5 L0,-10 M5,-1.5 L9.5,-1.5 M-5,-1.5 L-9.5,-1.5 M3,4.5 L6,9 M-3,4.5 L-6,9"
          stroke={colors.ballPattern} strokeWidth="0.9" fill="none" strokeLinecap="round"/>
      </g>
      <line x1="25" y1="56" x2="75" y2="56" stroke={colors.border} strokeWidth="0.4" opacity="0.6"/>
      <text x="50" y="72" textAnchor="middle" fill={colors.text}
        style={{ fontFamily: 'Archivo Black, sans-serif', fontSize: '15px', letterSpacing: '1.5px' }}>
        2026
      </text>
      <circle cx="44" cy="84" r="0.8" fill={colors.border}/>
      <circle cx="50" cy="84" r="0.8" fill={colors.border}/>
      <circle cx="56" cy="84" r="0.8" fill={colors.border}/>
    </svg>
  );
};

const StatusBadge = ({ status }) => {
  if (status === 'live') {
    return (
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#c8302e]/10 border border-[#c8302e]/25">
        <span className="w-1.5 h-1.5 rounded-full bg-[#c8302e] pulse-live" />
        <span className="text-[10px] font-bold text-[#c8302e] uppercase tracking-wider">Live</span>
      </div>
    );
  }
  if (status === 'finished') {
    return (
      <div className="px-2 py-0.5 rounded-full bg-[#1a1410]/5 border border-[#1a1410]/10">
        <span className="text-[10px] font-bold text-[#6b6359] uppercase tracking-wider">Baigta</span>
      </div>
    );
  }
  return null;
};

const PointsBadge = ({ points, type }) => {
  const styles = {
    exact: 'bg-[#0e6b47]/10 text-[#0e6b47] border-[#0e6b47]/25',
    diff: 'bg-[#b8860b]/10 text-[#b8860b] border-[#b8860b]/25',
    outcome: 'bg-[#0a2c4e]/10 text-[#0a2c4e] border-[#0a2c4e]/25',
    wrong: 'bg-[#1a1410]/5 text-[#6b6359] border-[#1a1410]/10',
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
      className="w-7 h-7 rounded-md bg-[#1a1410]/5 border border-[#1a1410]/10 flex items-center justify-center text-[#6b6359] hover:bg-[#1a1410]/10 hover:text-[#1a1410] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      <Minus className="w-3.5 h-3.5" />
    </button>
    <div className={`w-10 h-10 rounded-md flex items-center justify-center font-mono font-bold text-xl ${
      disabled ? 'bg-[#1a1410]/5 text-[#6b6359]' : 'bg-[#0e6b47]/10 text-[#0e6b47] border border-[#0e6b47]/30'
    }`}>
      {value}
    </div>
    <button
      onClick={() => onChange(Math.min(9, value + 1))}
      disabled={disabled}
      className="w-7 h-7 rounded-md bg-[#1a1410]/5 border border-[#1a1410]/10 flex items-center justify-center text-[#6b6359] hover:bg-[#1a1410]/10 hover:text-[#1a1410] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
      <span className="text-[11px] font-bold text-[#1a1410] leading-tight text-center px-1">
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
            <span className="text-[10px] font-bold text-[#0a2c4e] uppercase tracking-wider">
              {STAGE_LABELS[match.stage] || match.stage}
            </span>
          ) : (
            <span className="text-[10px] font-bold text-[#6b6359] uppercase tracking-wider">
              Grupė {match.group}
            </span>
          )}
          <span className="text-[#9d9489]">·</span>
          <span className="text-[10px] text-[#6b6359]">{formatKickoff(match.kickoff)}</span>
        </div>
        <StatusBadge status={match.status} />
      </div>

      <div className="grid grid-cols-3 items-center gap-3 mb-3">
        <TeamBlock code={match.home} />
        <div className="flex flex-col items-center">
          {(match.status === 'finished' || match.status === 'live') && match.actualScore ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#1a1410]/5 border border-[#1a1410]/10">
              <span className="font-display text-2xl text-[#1a1410]">{match.actualScore.home}</span>
              <span className="text-[#9d9489]">:</span>
              <span className="font-display text-2xl text-[#1a1410]">{match.actualScore.away}</span>
            </div>
          ) : (
            <div className="px-3 py-1.5 rounded-lg bg-[#1a1410]/5 border border-[#1a1410]/10">
              <span className="font-mono text-xs text-[#6b6359]">vs</span>
            </div>
          )}
        </div>
        <TeamBlock code={match.away} />
      </div>

      <div className="border-t border-[#1a1410]/10 pt-3 mt-3">
        {match.status === 'upcoming' && (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold text-[#0e6b47] uppercase tracking-wider flex items-center gap-1">
                <Target className="w-3 h-3" /> {prediction ? 'Tavo spėjimas' : 'Tavo prognozė'}
              </span>
              {tu && (
                <span className="text-[10px] font-mono text-[#6b6359]">
                  Spėjimas baigsis už {tu}
                </span>
              )}
            </div>
            <div className="flex items-center justify-center gap-3 mb-3">
              <ScoreInput value={localPred.home}
                onChange={(v) => setLocalPred({ ...localPred, home: v })}
                disabled={inputsDisabled} />
              <span className="text-[#6b6359] font-mono">:</span>
              <ScoreInput value={localPred.away}
                onChange={(v) => setLocalPred({ ...localPred, away: v })}
                disabled={inputsDisabled} />
            </div>

            {/* VIEW MODE: tik Redaguoti spėjimą mygtukas */}
            {!isEditing && prediction && (
              <button onClick={() => setIsEditing(true)}
                style={{ backgroundColor: '#f0ebe1', color: '#0a2c4e', border: '1px solid rgba(10, 44, 78, 0.15)' }}
                className="w-full py-2 rounded-lg text-xs font-bold uppercase tracking-wider hover:opacity-80 transition-all">
                Redaguoti spėjimą
              </button>
            )}

            {/* EDIT MODE: Save (+ Atšaukti jei jau buvo prognozė) */}
            {(isEditing || !prediction) && (
              <div className="flex gap-2">
                {prediction && (
                  <button onClick={handleCancel} disabled={saving}
                    style={{ backgroundColor: '#ffffff', color: '#6b6359', border: '1px solid rgba(20,17,16,0.15)' }}
                    className="flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider disabled:opacity-50 hover:bg-[#1a1410]/5 transition-all">
                    Atšaukti
                  </button>
                )}
                <button onClick={handleSave} disabled={!hasChanges || saving || justSaved}
                  style={(!hasChanges || justSaved) && !saving
                    ? { backgroundColor: '#f0ebe1', color: '#6b6359' }
                    : { backgroundColor: '#0e6b47', color: '#ffffff' }}
                  className={`${prediction ? 'flex-1' : 'w-full'} py-2 rounded-lg text-xs font-bold uppercase tracking-wider disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all`}>
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
              <Lock className="w-3.5 h-3.5 text-[#6b6359]" />
              {prediction ? (
                <span className="text-xs text-[#6b6359]">
                  Tavo spėjimas: <span className="font-mono font-bold text-[#1a1410]">{prediction.home}:{prediction.away}</span>
                </span>
              ) : (
                <span className="text-xs text-[#c8302e]">Nespėjai pažymėti prognozės</span>
              )}
            </div>
          </div>
        )}

        {match.status === 'finished' && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {prediction ? (
                <span className="text-xs text-[#6b6359]">
                  Spėjo: <span className="font-mono font-bold text-[#1a1410]">{prediction.home}:{prediction.away}</span>
                </span>
              ) : (
                <span className="text-xs text-[#6b6359]">Nespėjai pažymėti</span>
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
        selected ? 'scale-105' : 'bg-[#faf7f1] border-[#1a1410]/8 hover:border-[#1a1410]/20'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      style={selected ? { backgroundColor: `${accentColor}15`, borderColor: `${accentColor}60` } : {}}>
      <Flag code={team.code} className="w-12 h-8" />
      <span className="text-[11px] font-semibold text-[#1a1410] text-center leading-tight min-h-[28px] flex items-center">
        {team.name}
      </span>
      {selected && <Star className="w-3 h-3 fill-current" style={{ color: accentColor }} />}
    </button>
  );
};

const FormField = ({ label, type = 'text', placeholder, value, onChange, autoComplete }) => (
  <div>
    <label className="text-[10px] font-bold text-[#6b6359] uppercase tracking-wider block mb-1.5">{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      className="w-full px-4 py-3 rounded-lg bg-[#faf7f1] border border-[#1a1410]/10 text-[#1a1410] placeholder-[#9d9489] focus:outline-none focus:border-[#0e6b47]/50 font-medium"
    />
  </div>
);

const ErrorAlert = ({ message }) => message ? (
  <div className="flex items-start gap-2 p-3 rounded-lg bg-[#c8302e]/10 border border-[#c8302e]/30 mb-3">
    <AlertCircle className="w-4 h-4 text-[#c8302e] flex-shrink-0 mt-0.5" />
    <span className="text-sm text-[#c8302e]">{message}</span>
  </div>
) : null;

// === MODAL DIALOG (custom confirm/alert) ===

const ModalOverlay = ({ children, onClose }) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1a1410]/60 backdrop-blur-sm"
    onClick={onClose}>
    <div
      className="card-light rounded-2xl p-5 max-w-sm w-full"
      onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  </div>
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
      <h3 className="font-display text-base uppercase tracking-wider text-[#1a1410] mb-2">
        {state.title}
      </h3>
      {state.message && (
        <p className="text-sm text-[#6b6359] mb-4 whitespace-pre-line">{state.message}</p>
      )}
      {state.kind === 'confirm' ? (
        <div className="flex gap-2">
          <button
            onClick={() => close(false)}
            style={{ backgroundColor: '#ffffff', color: '#6b6359', border: '1px solid rgba(20,17,16,0.15)' }}
            className="flex-1 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-[#1a1410]/5 transition-all">
            {state.cancelLabel || 'Atšaukti'}
          </button>
          <button
            onClick={() => close(true)}
            style={{ backgroundColor: state.variant === 'danger' ? '#c8302e' : '#0e6b47', color: '#ffffff' }}
            className="flex-1 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all hover:opacity-90">
            {state.confirmLabel || 'Patvirtinti'}
          </button>
        </div>
      ) : (
        <button
          onClick={() => close(true)}
          style={{ backgroundColor: state.variant === 'danger' ? '#c8302e' : '#0e6b47', color: '#ffffff' }}
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
      <Loader2 className="w-8 h-8 text-[#0a2c4e] animate-spin" />
      <p className="text-sm text-[#6b6359] uppercase tracking-widest">Kraunama...</p>
    </div>
  </div>
);

const LoginScreen = ({ onSwitchToRegister }) => {
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

  return (
    <div className="app-bg font-body text-[#1a1410] min-h-screen flex items-center justify-center p-4">
      <Styles />
      <div className="max-w-md w-full">
        <div className="relative overflow-hidden rounded-2xl p-6 paper-grain mb-4"
          style={{ background: 'linear-gradient(135deg, #0a2c4e 0%, #051c30 100%)', color: '#faf7f1' }}>
          <div className="flex justify-center mb-4">
            <Emblem className="w-24 h-24" variant="dark" />
          </div>
          <h1 className="font-display text-center text-xl leading-tight">
            PASAULIO FUTBOLO<br/>ČEMPIONATAS
          </h1>
          <div className="flex items-center justify-center gap-3 my-3">
            <div className="h-px w-12" style={{ background: 'rgba(201, 169, 97, 0.5)' }}/>
            <span className="font-display text-base" style={{ color: '#c9a961', letterSpacing: '2px' }}>2026</span>
            <div className="h-px w-12" style={{ background: 'rgba(201, 169, 97, 0.5)' }}/>
          </div>
          <p className="font-display text-center text-sm tracking-widest opacity-90">TOTALIZATORIUS</p>
          <p className="text-[10px] uppercase tracking-widest opacity-60 mt-3 text-center">
            Vidinis pulas · birž. 11 — liep. 19
          </p>
        </div>

        <div className="card-light rounded-2xl p-5">
          <h2 className="font-display text-lg uppercase tracking-wider text-[#1a1410] mb-4">Prisijungimas</h2>

          <ErrorAlert message={error} />

          <div className="space-y-3">
            <FormField label="El. paštas" type="email" placeholder="vardas@example.com"
              value={email} onChange={setEmail} autoComplete="email" />
            <FormField label="Slaptažodis" type="password" placeholder="••••••••"
              value={password} onChange={setPassword} autoComplete="current-password" />
          </div>

          <div className="grid grid-cols-2 gap-2 mt-5">
            <button onClick={handleLogin} disabled={loading}
              style={{ backgroundColor: '#0e6b47', color: '#ffffff' }}
              className="py-3 rounded-xl font-display uppercase tracking-wider transition-opacity hover:opacity-90 shadow-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Prisijungti
            </button>
            <button onClick={onSwitchToRegister} disabled={loading}
              style={{ backgroundColor: '#ffffff', color: '#0e6b47', border: '2px solid #0e6b47' }}
              className="py-3 rounded-xl font-display uppercase tracking-wider transition-colors text-sm disabled:opacity-50">
              Registruotis
            </button>
          </div>
        </div>

        <div className="flex items-center justify-center gap-1.5 mt-4 text-[10px] text-[#6b6359] uppercase tracking-widest">
          <Lock className="w-3 h-3" /> Saugu · Šifruota · Privatu
        </div>
      </div>
    </div>
  );
};

const RegisterScreen = ({ onSwitchToLogin, companies = [] }) => {
  const [form, setForm] = useState({ username: '', fullName: '', email: '', password: '', companyChoice: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const updateField = (field) => (value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleRegister = async () => {
    if (!form.username || !form.fullName || !form.email || !form.password) {
      setError('Užpildyk visus laukus');
      return;
    }
    if (!form.companyChoice) {
      setError('Pasirink įmonę (arba "Be įmonės")');
      return;
    }
    if (form.password.length < 6) {
      setError('Slaptažodis turi būti bent 6 simboliai');
      return;
    }
    if (form.username.length < 3) {
      setError('Vartotojo vardas turi būti bent 3 simboliai');
      return;
    }
    setError('');
    setLoading(true);
    try {
      // companyChoice: "none" = Be įmonės, kitaip = company.id
      let companyId = null;
      let companyName = null;
      if (form.companyChoice !== 'none') {
        const company = companies.find((c) => c.id === form.companyChoice);
        if (company) {
          companyId = company.id;
          companyName = company.name;
        }
      }
      await registerUser(form.email, form.password, form.username, form.fullName, companyId, companyName);
      // onAuthChange auto-pakeis ekraną
    } catch (err) {
      setError(translateAuthError(err.code) || err.message);
      setLoading(false);
    }
  };

  return (
    <div className="app-bg font-body text-[#1a1410] min-h-screen flex items-center justify-center p-4">
      <Styles />
      <div className="max-w-md w-full">
        <button onClick={onSwitchToLogin} disabled={loading}
          className="text-[#6b6359] hover:text-[#1a1410] flex items-center gap-1 mb-3 text-sm font-semibold disabled:opacity-50">
          <ChevronLeft className="w-4 h-4" /> Atgal
        </button>

        <div className="card-light rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <Trophy className="w-5 h-5 text-[#0e6b47]" />
            <h2 className="font-display text-lg uppercase tracking-wider text-[#1a1410]">Registracija</h2>
          </div>
          <p className="text-xs text-[#6b6359] mb-4">Sukurk paskyrą ir pradėk prognozuoti</p>

          <ErrorAlert message={error} />

          <div className="space-y-3">
            <FormField label="Vartotojo vardas" placeholder="pvz., paulius_lt"
              value={form.username} onChange={updateField('username')} autoComplete="username" />
            <FormField label="Vardas Pavardė" placeholder="pvz., Paulius Pavardenis"
              value={form.fullName} onChange={updateField('fullName')} autoComplete="name" />
            <FormField label="El. paštas" type="email" placeholder="vardas@example.com"
              value={form.email} onChange={updateField('email')} autoComplete="email" />
            <FormField label="Slaptažodis" type="password" placeholder="Bent 6 simboliai"
              value={form.password} onChange={updateField('password')} autoComplete="new-password" />

            {/* Company dropdown */}
            <div>
              <label className="block text-[10px] font-bold text-[#6b6359] uppercase tracking-wider mb-1">Įmonė</label>
              <select
                value={form.companyChoice}
                onChange={(e) => updateField('companyChoice')(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-white border border-[#1a1410]/15 text-sm text-[#1a1410] focus:outline-none focus:border-[#0e6b47] disabled:opacity-50"
                disabled={loading}>
                <option value="" disabled>-- Pasirinkti įmonę --</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                <option value="none">Be įmonės</option>
              </select>
              {companies.length === 0 && (
                <p className="text-[10px] text-[#6b6359] mt-1">
                  Įmonių dar nėra. Gali pasirinkti "Be įmonės" arba palaukti kol admin'as pridės.
                </p>
              )}
            </div>
          </div>

          <button onClick={handleRegister} disabled={loading}
            style={{ backgroundColor: '#0e6b47', color: '#ffffff' }}
            className="w-full py-3 rounded-xl font-display uppercase tracking-wider transition-opacity hover:opacity-90 shadow-lg text-sm mt-5 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Sukurti paskyrą
          </button>

          <p className="text-[10px] text-center text-[#6b6359] mt-3">
            Sukurdamas paskyrą sutinki su naudojimo taisyklėmis
          </p>
        </div>

        <p className="text-xs text-center text-[#6b6359] mt-4">
          Jau turi paskyrą? <button onClick={onSwitchToLogin} className="text-[#0e6b47] font-bold hover:underline">Prisijungti</button>
        </p>
      </div>
    </div>
  );
};

// ============================================================
// APP SCREENS
// ============================================================

const HomeScreen = ({ userProfile, usersWithPoints, matches, predictions, setScreen, onUpdatePrediction }) => {
  const sortedUsers = [...usersWithPoints].sort((a, b) => b.points - a.points);
  const me = sortedUsers.find((u) => u.uid === userProfile.uid) || userProfile;
  const myRank = sortedUsers.findIndex((u) => u.uid === userProfile.uid) + 1;
  const upcomingMatches = matches.filter((m) => m.status === 'upcoming').slice(0, 6);
  const liveMatches = matches.filter((m) => m.status === 'live');

  const upcomingSection = upcomingMatches.length > 0 && (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[#0e6b47]" />
          <h2 className="font-display text-sm uppercase tracking-wider text-[#1a1410]">Artimiausios</h2>
        </div>
        <button onClick={() => setScreen('matches')}
          className="text-[10px] font-bold text-[#0e6b47] uppercase tracking-wider flex items-center gap-1">
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

  const leaderboardSection = sortedUsers.length > 0 && (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Crown className="w-4 h-4 text-[#b8860b]" />
        <h2 className="font-display text-sm uppercase tracking-wider text-[#1a1410]">Lyderiai</h2>
      </div>
      <div className="card-light rounded-xl p-2">
        {sortedUsers.slice(0, 5).map((u, i) => (
          <div key={u.uid} className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#1a1410]/5 transition-colors">
            <div className="font-display text-xl w-6 text-center"
              style={{ color: i === 0 ? '#b8860b' : i === 1 ? '#94806f' : i === 2 ? '#a85a2a' : '#9d9489' }}>
              {i + 1}
            </div>
            <div className="w-8 h-8 rounded-full flex items-center justify-center font-display text-sm"
              style={{ backgroundColor: `${u.avatarColor}20`, color: u.avatarColor }}>
              {u.avatarLetter}
            </div>
            <div className="flex-1 text-sm font-semibold text-[#1a1410] truncate">{u.username}</div>
            <div className="font-mono font-bold text-[#0e6b47]">{u.points}</div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4 pb-24 lg:pb-8">
      <div className="relative overflow-hidden rounded-2xl p-5 lg:p-7 paper-grain"
        style={{ background: 'linear-gradient(135deg, #0a2c4e 0%, #051c30 100%)', color: '#faf7f1' }}>
        <div className="flex items-start gap-4 mb-4">
          <Emblem className="w-16 h-16 lg:w-20 lg:h-20 flex-shrink-0" variant="dark" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest mb-1 opacity-70">
              Sveikas, {userProfile.username}
            </div>
            <h1 className="font-display text-base lg:text-xl leading-tight">
              PASAULIO FUTBOLO<br/>ČEMPIONATAS 2026
            </h1>
            <div className="text-[10px] uppercase tracking-widest opacity-60 mt-1" style={{ color: '#c9a961' }}>
              Totalizatorius
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-white/15">
          <div>
            <div className="text-[10px] uppercase tracking-wider mb-1 opacity-60">Taškai</div>
            <div className="font-display text-2xl lg:text-3xl">{me.points || 0}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider mb-1 opacity-60">Vieta</div>
            <div className="font-display text-2xl lg:text-3xl">#{myRank || '-'}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider mb-1 opacity-60">Serija</div>
            <div className="font-display text-2xl lg:text-3xl flex items-center gap-1" style={{ color: '#f5d27a' }}>
              {me.streak || 0} <Flame className="w-5 h-5 lg:w-6 lg:h-6" />
            </div>
          </div>
        </div>
      </div>

      {liveMatches.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Radio className="w-4 h-4 text-[#c8302e] pulse-live" />
            <h2 className="font-display text-sm uppercase tracking-wider text-[#1a1410]">Vyksta dabar</h2>
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
          <AlertCircle className="w-8 h-8 text-[#b8860b] mx-auto mb-2" />
          <p className="text-sm text-[#1a1410] font-semibold mb-1">Dar nėra įvestų rungtynių</p>
          <p className="text-xs text-[#6b6359]">Administratorius dar nesuvedė rungtynių sąrašo.</p>
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
    if (filter === 'all') return matches;
    if (filter === 'upcoming') return matches.filter((m) => m.status === 'upcoming');
    if (filter === 'finished') return matches.filter((m) => m.status === 'finished');
    if (filter === 'knockout') return matches.filter((m) => m.stage && m.stage !== 'group');
    return matches.filter((m) => m.group === filter);
  }, [filter, matches]);

  return (
    <div className="space-y-4 pb-24 lg:pb-8">
      <div>
        <h1 className="font-display text-3xl lg:text-4xl text-[#1a1410] mb-1">RUNGTYNĖS</h1>
        <p className="text-sm text-[#6b6359]">Spėk rezultatą iki rungtynių pradžios</p>
      </div>

      <div className="flex gap-2 overflow-x-auto lg:flex-wrap lg:overflow-visible scrollbar-hide -mx-1 px-1">
        {[
          { id: 'all', label: 'Visos' },
          { id: 'upcoming', label: 'Būsimos' },
          { id: 'finished', label: 'Baigtos' },
          { id: 'knockout', label: 'Knockout' },
          { id: 'A', label: 'A' }, { id: 'B', label: 'B' }, { id: 'C', label: 'C' },
          { id: 'D', label: 'D' }, { id: 'E', label: 'E' }, { id: 'F', label: 'F' },
          { id: 'G', label: 'G' }, { id: 'H', label: 'H' }, { id: 'I', label: 'I' },
          { id: 'J', label: 'J' }, { id: 'K', label: 'K' }, { id: 'L', label: 'L' },
        ].map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
              filter === f.id ? 'bg-[#0e6b47] text-white' : 'bg-white text-[#6b6359] border border-[#1a1410]/10 hover:text-[#1a1410]'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {filteredMatches.length === 0 ? (
        <div className="card-light rounded-xl p-5 text-center">
          <p className="text-sm text-[#6b6359]">Nėra rungtynių pagal pasirinktą filtrą</p>
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
    { key: 'bestPlayer', label: 'Geriausias turnyro žaidėjas', icon: Trophy, points: 15, color: '#b8860b' },
    { key: 'topScorer', label: 'Daugiausiai įvarčių įmušęs žaidėjas', icon: Target, points: 15, color: '#0e6b47' },
    { key: 'bestGoalkeeper', label: 'Geriausias vartininkas', icon: Shield, points: 15, color: '#0a2c4e' },
    { key: 'bestYoungPlayer', label: 'Geriausias 21m. ar jaunesnis žaidėjas', icon: Star, points: 15, color: '#c8302e' },
  ];

  return (
    <div className="space-y-4 pb-24 lg:pb-8">
      <div>
        <h1 className="font-display text-3xl lg:text-4xl text-[#1a1410] mb-1">PROGNOZĖS</h1>
        <p className="text-sm text-[#6b6359]">
          {isLocked
            ? 'Prognozės užšaldytos · turnyras prasidėjęs'
            : `Spėjimas galimas iki pirmųjų rungtynių${tu ? ` · baigsis už ${tu}` : ''}`}
        </p>
      </div>

      {/* ČEMPIONAS */}
      <div className="card-light rounded-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Crown className="w-5 h-5 text-[#b8860b]" />
            <h3 className="font-display text-lg text-[#1a1410]">ČEMPIONAS</h3>
          </div>
          <span className="text-[10px] font-bold text-[#b8860b] uppercase tracking-wider">25 tšk.</span>
        </div>
        <p className="text-xs text-[#6b6359] mb-4">Pasirink turnyro nugalėtoją</p>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
          {allCountries.map((code) => (
            <TeamPickButton key={code} code={code}
              selected={local.champion === code}
              onClick={() => !inputsDisabled && setLocal({ ...local, champion: code })}
              accentColor="#b8860b"
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
              <h3 className="font-display text-sm text-[#1a1410] uppercase tracking-wider">{label}</h3>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ml-2" style={{ color }}>
              {points} tšk.
            </span>
          </div>
          <p className="text-xs text-[#6b6359] mb-3">Įrašyk žaidėjo vardą ir pavardę</p>
          <input type="text"
            placeholder="pvz., Lionel Messi"
            value={local[key]}
            onChange={(e) => setLocal({ ...local, [key]: e.target.value })}
            disabled={inputsDisabled}
            className="w-full px-4 py-3 rounded-lg bg-[#faf7f1] border border-[#1a1410]/10 text-[#1a1410] placeholder-[#9d9489] focus:outline-none focus:border-[#0e6b47]/50 font-medium disabled:opacity-60 disabled:cursor-not-allowed" />
        </div>
      ))}
      </div>

      {/* MYGTUKAI */}
      {isLocked ? (
        <div className="rounded-xl p-3 bg-[#1a1410]/5 border border-[#1a1410]/10 flex items-center gap-2">
          <Lock className="w-4 h-4 text-[#6b6359]" />
          <span className="text-xs text-[#6b6359]">Prognozės užšaldytos. Turnyras jau prasidėjęs.</span>
        </div>
      ) : !isEditing && hasSavedPrediction ? (
        // VIEW MODE
        <button onClick={() => setIsEditing(true)}
          style={{ backgroundColor: '#f0ebe1', color: '#0a2c4e', border: '1px solid rgba(10, 44, 78, 0.15)' }}
          className="w-full py-3 rounded-xl text-xs font-bold uppercase tracking-wider hover:opacity-80 transition-all">
          Redaguoti prognozes
        </button>
      ) : (
        // EDIT MODE
        <div className="flex gap-2">
          {hasSavedPrediction && (
            <button onClick={handleCancel} disabled={saving}
              style={{ backgroundColor: '#ffffff', color: '#6b6359', border: '1px solid rgba(20,17,16,0.15)' }}
              className="flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-wider disabled:opacity-50 hover:bg-[#1a1410]/5 transition-all">
              Atšaukti
            </button>
          )}
          <button onClick={handleSave} disabled={!hasChanges || saving || justSaved || !hasAnyValue}
            style={(!hasChanges || justSaved || !hasAnyValue) && !saving
              ? { backgroundColor: '#f0ebe1', color: '#6b6359' }
              : { backgroundColor: '#0e6b47', color: '#ffffff' }}
            className={`${hasSavedPrediction ? 'flex-1' : 'w-full'} py-3 rounded-xl text-xs font-bold uppercase tracking-wider disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all`}>
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
    arr.sort((a, b) => b.avgPoints - a.avgPoints);
    return arr;
  }, [sortedUsers]);

  const tabs = [
    { id: 'overall', label: 'Bendra' },
    { id: 'company', label: 'Mano įmonė' },
    { id: 'companies', label: 'Įmonės' },
  ];

  if (sortedUsers.length === 0) {
    return (
      <div className="card-light rounded-xl p-6 text-center pb-24">
        <p className="text-sm text-[#6b6359]">Dar nėra dalyvių</p>
      </div>
    );
  }

  const renderUserRow = (u, i, isMe) => (
    <div key={u.uid}
      className={`flex items-center gap-3 p-3 border-b border-[#1a1410]/8 last:border-0 ${isMe ? 'bg-[#0e6b47]/5' : ''}`}>
      <div className="font-display text-sm w-6 text-center text-[#6b6359]">{i + 1}</div>
      <div className="w-9 h-9 rounded-full flex items-center justify-center font-display text-sm"
        style={{ backgroundColor: `${u.avatarColor}20`, color: u.avatarColor }}>
        {u.avatarLetter}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-semibold truncate ${isMe ? 'text-[#0e6b47]' : 'text-[#1a1410]'}`}>
          {u.username} {isMe && <span className="text-[10px] ml-1 opacity-70">(tu)</span>}
        </div>
        <div className="text-[10px] text-[#6b6359] flex items-center gap-2 truncate">
          {u.companyName ? (
            <span className="truncate">{u.companyName}</span>
          ) : (
            <span className="opacity-60">Be įmonės</span>
          )}
          <span className="flex items-center gap-0.5"><Flame className="w-2.5 h-2.5" />{u.streak || 0}</span>
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono font-bold text-[#0e6b47]">{u.points}</div>
        <div className="text-[9px] text-[#6b6359] uppercase tracking-wider">tšk.</div>
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
          const colors = ['#94806f', '#b8860b', '#a85a2a'];
          return (
            <div key={u.uid} className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-full flex items-center justify-center font-display text-lg mb-2 bg-white"
                style={{ color: u.avatarColor, border: `2px solid ${u.avatarColor}` }}>
                {u.avatarLetter}
              </div>
              <div className="text-xs font-bold text-[#1a1410] mb-1 truncate w-full text-center">{u.username}</div>
              <div className="font-mono text-xs text-[#0e6b47] mb-2">{u.points} tšk.</div>
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

  return (
    <div className="space-y-4 pb-24 lg:pb-8">
      <div>
        <h1 className="font-display text-3xl lg:text-4xl text-[#1a1410] mb-1">LYDERIAI</h1>
        <p className="text-sm text-[#6b6359]">
          {tab === 'overall' && `${sortedUsers.length} ${pluralizeLt(sortedUsers.length, ['dalyvis', 'dalyviai', 'dalyvių'])} · atnaujinama tiesiogiai`}
          {tab === 'company' && userProfile.companyName && `${myCompanyUsers.length} ${pluralizeLt(myCompanyUsers.length, ['dalyvis', 'dalyviai', 'dalyvių'])} iš ${userProfile.companyName}`}
          {tab === 'company' && !userProfile.companyName && 'Tu nepriklausai įmonei'}
          {tab === 'companies' && `${companyStats.length} ${pluralizeLt(companyStats.length, ['įmonė', 'įmonės', 'įmonių'])} · vidurkis vienam dalyviui`}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-[#1a1410]/5 lg:max-w-md">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={tab === t.id ? { backgroundColor: '#ffffff', color: '#1a1410' } : { color: '#6b6359' }}
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
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[#1a1410]/5 flex items-center justify-center">
                <Settings className="w-6 h-6 text-[#6b6359]" />
              </div>
              <p className="text-sm font-bold text-[#1a1410] mb-1">Tu nepriklausai įmonei</p>
              <p className="text-xs text-[#6b6359]">Susisiek su admin'u, kad priskirtų tave įmonei.</p>
            </div>
          ) : (
            <>
              <div className="card-light rounded-xl p-3 flex items-center gap-2 lg:max-w-md">
                <div className="w-2 h-8 rounded-full bg-[#0e6b47]"></div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-[#6b6359] uppercase tracking-wider">Tavo įmonė</div>
                  <div className="font-display text-base text-[#1a1410] truncate">{userProfile.companyName}</div>
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
          <div className="rounded-xl p-3 bg-[#0a2c4e]/5 border border-[#0a2c4e]/15">
            <p className="text-[11px] text-[#0a2c4e] leading-relaxed">
              <span className="font-bold">Kaip skaičiuojama:</span> įmonės rikiuojamos pagal taškų <span className="font-bold">vidurkį vienam dalyviui</span>.
              Taip mažos įmonės gali sąžiningai konkuruoti su didelėmis - dydis nesuteikia pranašumo.
            </p>
          </div>

          {companyStats.length === 0 ? (
            <div className="card-light rounded-xl p-6 text-center">
              <p className="text-sm text-[#6b6359]">Dar nėra įmonių su dalyviais</p>
            </div>
          ) : (
            <div className="card-light rounded-xl overflow-hidden">
              {companyStats.map((c, i) => {
                const isMyCompany = c.companyId === userProfile.companyId;
                return (
                  <div key={c.companyId}
                    className={`flex items-center gap-3 p-3 border-b border-[#1a1410]/8 last:border-0 ${isMyCompany ? 'bg-[#0e6b47]/5' : ''}`}>
                    <div className="font-display text-sm w-6 text-center text-[#6b6359]">{i + 1}</div>
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center font-display text-sm bg-[#0a2c4e]/10 text-[#0a2c4e]">
                      {(c.companyName || '?')[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-semibold truncate ${isMyCompany ? 'text-[#0e6b47]' : 'text-[#1a1410]'}`}>
                        {c.companyName} {isMyCompany && <span className="text-[10px] ml-1 opacity-70">(tavo)</span>}
                      </div>
                      <div className="text-[10px] text-[#6b6359]">
                        {c.memberCount} {pluralizeLt(c.memberCount, ['dalyvis', 'dalyviai', 'dalyvių'])} · {c.totalPoints} tšk. iš viso
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-bold text-[#0e6b47]">{c.avgPoints.toFixed(1)}</div>
                      <div className="text-[9px] text-[#6b6359] uppercase tracking-wider">vid.</div>
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

const ProfileScreen = ({ userProfile, usersWithPoints, matches, predictions, tournamentResults, onLogout, onOpenAdmin }) => {
  const me = usersWithPoints.find((u) => u.uid === userProfile.uid) || userProfile;
  const finishedMatches = matches.filter((m) => m.status === 'finished');

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
        <div className="w-20 h-20 rounded-full mx-auto mb-3 flex items-center justify-center font-display text-3xl bg-[#faf7f1]"
          style={{ color: userProfile.avatarColor, border: `3px solid ${userProfile.avatarColor}` }}>
          {userProfile.avatarLetter}
        </div>
        <h2 className="font-display text-2xl text-[#1a1410]">{userProfile.username}</h2>
        <p className="text-sm text-[#1a1410] mt-1">{userProfile.fullName}</p>
        <p className="text-xs text-[#6b6359]">{userProfile.email}</p>

        {/* Įmonės informacija */}
        <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0a2c4e]/8 border border-[#0a2c4e]/20">
          <Trophy className="w-3 h-3 text-[#0a2c4e]" />
          <span className="text-[10px] font-bold text-[#0a2c4e] uppercase tracking-wider">
            {userProfile.companyName || 'Be įmonės'}
          </span>
        </div>

        {userProfile.isAdmin && (
          <div className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full bg-[#0a2c4e]/10 border border-[#0a2c4e]/30 ml-2">
            <Settings className="w-3 h-3 text-[#0a2c4e]" />
            <span className="text-[10px] font-bold text-[#0a2c4e] uppercase tracking-wider">Administratorius</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:col-span-2 lg:grid-cols-2 lg:self-stretch">
        <div className="card-light rounded-xl p-4 flex flex-col justify-center">
          <div className="text-[10px] text-[#6b6359] uppercase tracking-wider mb-1">Iš viso taškų</div>
          <div className="font-display text-3xl lg:text-5xl text-[#0e6b47]">{me.points || 0}</div>
        </div>
        <div className="card-light rounded-xl p-4 flex flex-col justify-center">
          <div className="text-[10px] text-[#6b6359] uppercase tracking-wider mb-1">Tikslių rezultatų</div>
          <div className="font-display text-3xl lg:text-5xl text-[#b8860b]">{stats.exact}</div>
        </div>
      </div>
      </div>

      <div className="card-light rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-sm uppercase tracking-wider text-[#1a1410]">Tikslumas</h3>
          <span className="text-[10px] text-[#6b6359]">
            {stats.predicted}/{stats.total} sp{pluralizeLt(stats.predicted, ['ėjimas', 'ėjimai', 'ėjimų'])}
            {stats.missed > 0 && ` · ${stats.missed} praleist${pluralizeLt(stats.missed, ['a', 'os', 'ų'])}`}
          </span>
        </div>
        <div className="space-y-2">
          {[
            { label: 'Tikslus rezultatas', count: stats.exact, color: '#0e6b47' },
            { label: 'Teisingas skirtumas', count: stats.diff, color: '#b8860b' },
            { label: 'Tik baigtis', count: stats.outcome, color: '#0a2c4e' },
            { label: 'Pro šalį', count: stats.wrong, color: '#9d9489' },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-3">
              <div className="text-xs flex-1 text-[#1a1410]">{s.label}</div>
              <div className="flex-1 h-1.5 bg-[#1a1410]/8 rounded-full overflow-hidden">
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
            <h3 className="font-display text-sm uppercase tracking-wider text-[#1a1410]">Turnyro prognozės</h3>
            <span className="font-mono text-sm font-bold text-[#0e6b47]">+{me.tournamentPoints || 0} tšk.</span>
          </div>
          <div className="space-y-1.5">
            {[
              { label: 'Čempionas', key: 'champion', points: 25, color: '#b8860b' },
              { label: 'Geriausias žaidėjas', key: 'bestPlayer', points: 15, color: '#b8860b' },
              { label: 'Strielcas', key: 'topScorer', points: 15, color: '#0e6b47' },
              { label: 'Vartininkas', key: 'bestGoalkeeper', points: 15, color: '#0a2c4e' },
              { label: 'Jaunasis', key: 'bestYoungPlayer', points: 15, color: '#c8302e' },
            ].map((row) => {
              const earned = me.tournamentBreakdown?.[row.key] > 0;
              const hasResult = row.key === 'champion' ? !!tournamentResults.champion : !!tournamentResults[row.key];
              if (!hasResult) return null;
              return (
                <div key={row.key} className="flex items-center justify-between text-xs">
                  <span className="text-[#1a1410]">{row.label}</span>
                  {earned ? (
                    <span className="font-mono font-bold" style={{ color: row.color }}>+{row.points} tšk.</span>
                  ) : (
                    <span className="text-[#9d9489]">−</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {userProfile.isAdmin && (
        <button onClick={onOpenAdmin}
          style={{ backgroundColor: '#0a2c4e', color: '#ffffff' }}
          className="w-full py-3 rounded-xl font-display uppercase tracking-wider transition-opacity hover:opacity-90 text-sm flex items-center justify-center gap-2">
          <Settings className="w-4 h-4" /> Administratoriaus skydas
        </button>
      )}

      <button onClick={onLogout}
        style={{ backgroundColor: '#ffffff', color: '#c8302e', border: '1px solid rgba(200, 48, 46, 0.3)' }}
        className="w-full py-3 rounded-xl font-display uppercase tracking-wider transition-colors text-sm flex items-center justify-center gap-2 hover:bg-[#c8302e]/5">
        <LogOut className="w-4 h-4" /> Atsijungti
      </button>
    </div>
  );
};

// === BRACKET SCREEN (knockout vizualizacija) ===

const KNOCKOUT_STAGES = ['round_of_32', 'round_of_16', 'quarter_final', 'semi_final', 'third_place', 'final'];

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
      <div className="text-[9px] text-[#6b6359] mb-1.5 truncate">{formatKickoff(match.kickoff)}</div>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Flag code={home?.code} className="w-5 h-3.5 flex-shrink-0" />
            <span className="text-[11px] font-semibold text-[#1a1410] truncate">
              {home?.name || <span className="text-[#9d9489]">TBD</span>}
            </span>
          </div>
          {(match.status === 'finished' || match.status === 'live') && match.actualScore ? (
            <span className="font-mono text-sm font-bold text-[#1a1410]">{match.actualScore.home}</span>
          ) : !isLocked && !noTeams ? (
            <div className="flex items-center gap-0.5">
              <button onClick={() => setLocalPred({ ...localPred, home: Math.max(0, localPred.home - 1) })}
                className="w-5 h-5 rounded bg-[#1a1410]/5 text-[#6b6359] text-xs leading-none">−</button>
              <span className="w-5 text-center font-mono text-xs font-bold text-[#0e6b47]">{localPred.home}</span>
              <button onClick={() => setLocalPred({ ...localPred, home: Math.min(9, localPred.home + 1) })}
                className="w-5 h-5 rounded bg-[#1a1410]/5 text-[#6b6359] text-xs leading-none">+</button>
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Flag code={away?.code} className="w-5 h-3.5 flex-shrink-0" />
            <span className="text-[11px] font-semibold text-[#1a1410] truncate">
              {away?.name || <span className="text-[#9d9489]">TBD</span>}
            </span>
          </div>
          {(match.status === 'finished' || match.status === 'live') && match.actualScore ? (
            <span className="font-mono text-sm font-bold text-[#1a1410]">{match.actualScore.away}</span>
          ) : !isLocked && !noTeams ? (
            <div className="flex items-center gap-0.5">
              <button onClick={() => setLocalPred({ ...localPred, away: Math.max(0, localPred.away - 1) })}
                className="w-5 h-5 rounded bg-[#1a1410]/5 text-[#6b6359] text-xs leading-none">−</button>
              <span className="w-5 text-center font-mono text-xs font-bold text-[#0e6b47]">{localPred.away}</span>
              <button onClick={() => setLocalPred({ ...localPred, away: Math.min(9, localPred.away + 1) })}
                className="w-5 h-5 rounded bg-[#1a1410]/5 text-[#6b6359] text-xs leading-none">+</button>
            </div>
          ) : null}
        </div>
      </div>
      {!isLocked && !noTeams && hasChanges && (
        <button onClick={handleSave} disabled={saving}
          style={{ backgroundColor: '#0e6b47', color: '#ffffff' }}
          className="w-full mt-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider disabled:opacity-50 flex items-center justify-center gap-1">
          {saving && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
          Patvirtinti
        </button>
      )}
      {match.status === 'finished' && pointsResult && (
        <div className="mt-1.5 text-center">
          <span className="text-[9px] text-[#6b6359]">
            Spėjo {prediction ? `${prediction.home}:${prediction.away}` : '−'} ·
          </span>
          <span className="text-[9px] font-bold ml-1" style={{
            color: pointsResult.type === 'exact' ? '#0e6b47' :
                   pointsResult.type === 'diff' ? '#b8860b' :
                   pointsResult.type === 'outcome' ? '#0a2c4e' : '#9d9489'
          }}>+{pointsResult.pts} tšk.</span>
        </div>
      )}
      {isLocked && !pointsResult && prediction && (
        <div className="mt-1.5 text-center text-[9px] text-[#6b6359]">
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
          <h1 className="font-display text-3xl lg:text-4xl text-[#1a1410] mb-1">KNOCKOUT</h1>
          <p className="text-sm text-[#6b6359]">1/16 finalas · Aštuntfinalis · ... · Finalas</p>
        </div>
        <div className="card-light rounded-xl p-6 text-center">
          <AlertCircle className="w-8 h-8 text-[#b8860b] mx-auto mb-2" />
          <p className="text-sm text-[#1a1410] font-semibold mb-1">Knockout etapas dar nesukurtas</p>
          <p className="text-xs text-[#6b6359]">Administratorius gali sukurti struktūrą admin skydelyje.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24 lg:pb-8">
      <div>
        <h1 className="font-display text-3xl lg:text-4xl text-[#1a1410] mb-1">KNOCKOUT</h1>
        <p className="text-sm text-[#6b6359]">{knockoutMatches.length} rungtynių · spėk visus etapus</p>
      </div>

      {/* Mobile: stack vertically. Desktop: horizontal scroll bracket */}
      <div className="lg:overflow-x-auto lg:scrollbar-hide">
        <div className="space-y-6 lg:space-y-0 lg:flex lg:gap-4 lg:min-w-max">
          {KNOCKOUT_STAGES.map((stage) => {
            const stageMatches = byStage[stage];
            if (!stageMatches || stageMatches.length === 0) return null;
            return (
              <div key={stage} className="lg:w-64 lg:flex-shrink-0">
                <div className="font-display text-xs uppercase tracking-wider text-[#0a2c4e] mb-3 px-1">
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
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
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
      await createCompany(newName);
      setNewName('');
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
      await updateCompany(editingId, editName);
      setEditingId(null);
      setEditName('');
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
        <div className="font-display text-sm uppercase tracking-wider text-[#1a1410] mb-3">Nauja įmonė</div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Pavadinimas, pvz., VMG"
            disabled={busy}
            className="flex-1 px-3 py-2 rounded-lg bg-[#faf7f1] border border-[#1a1410]/10 text-sm focus:outline-none focus:border-[#0e6b47]/50 disabled:opacity-50" />
          <button
            onClick={handleCreate}
            disabled={busy || !newName.trim()}
            style={{ backgroundColor: '#0e6b47', color: '#ffffff' }}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider disabled:opacity-50 flex items-center gap-1">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <Plus className="w-3.5 h-3.5" /> Pridėti
          </button>
        </div>
      </div>

      {/* Sąrašas */}
      {companies.length === 0 ? (
        <div className="card-light rounded-xl p-5 text-center">
          <p className="text-sm text-[#6b6359]">Įmonių dar nėra. Pridėk pirmąją virš.</p>
        </div>
      ) : (
        <div className="card-light rounded-xl overflow-hidden">
          {companies.map((c) => {
            const count = userCounts[c.id] || 0;
            const isEditing = editingId === c.id;
            return (
              <div key={c.id} className="flex items-center gap-3 p-3 border-b border-[#1a1410]/8 last:border-0">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center font-display text-sm bg-[#0a2c4e]/10 text-[#0a2c4e] flex-shrink-0">
                  {(c.name || '?')[0].toUpperCase()}
                </div>
                {isEditing ? (
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                    autoFocus
                    disabled={busy}
                    className="flex-1 px-3 py-1.5 rounded border border-[#0e6b47]/40 text-sm focus:outline-none focus:border-[#0e6b47]" />
                ) : (
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[#1a1410] truncate">{c.name}</div>
                    <div className="text-[10px] text-[#6b6359]">
                      {count} {pluralizeLt(count, ['dalyvis', 'dalyviai', 'dalyvių'])}
                    </div>
                  </div>
                )}
                {isEditing ? (
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={handleSaveEdit} disabled={busy || !editName.trim()}
                      style={{ backgroundColor: '#0e6b47', color: '#ffffff' }}
                      className="px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider disabled:opacity-50">
                      Saugoti
                    </button>
                    <button onClick={() => { setEditingId(null); setEditName(''); }}
                      className="px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider bg-white border border-[#1a1410]/15">
                      Atš.
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => { setEditingId(c.id); setEditName(c.name); }}
                      className="px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider text-[#0a2c4e] hover:bg-[#0a2c4e]/5">
                      Keisti
                    </button>
                    <button onClick={() => handleDelete(c)} disabled={busy}
                      className="px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider text-[#c8302e] hover:bg-[#c8302e]/5 disabled:opacity-50">
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

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...users].sort((a, b) => (a.username || '').localeCompare(b.username || '', 'lt'));
    if (!q) return sorted;
    return sorted.filter(
      (u) =>
        (u.username || '').toLowerCase().includes(q) ||
        (u.fullName || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q)
    );
  }, [users, search]);

  const handleToggleAdmin = async (user) => {
    const willBeAdmin = !user.isAdmin;
    if (user.uid === currentUid && !willBeAdmin) {
      const ok = await confirm({
        title: 'Atimti sau admin teises?',
        message: 'Po šio veiksmo nebematysi admin panelės. Atstatyti gali tik kitas admin'as arba Firebase Console.',
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
        await setUserCompany(user.uid, null, null);
      } else {
        const company = companies.find((c) => c.id === companyId);
        await setUserCompany(user.uid, companyId, company?.name || null);
      }
    } catch (err) {
      await notify({ title: 'Klaida', message: err.message, variant: 'danger' });
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Ieškoti pagal vardą, el. paštą..."
        className="w-full px-3 py-2 rounded-lg bg-white border border-[#1a1410]/10 text-sm focus:outline-none focus:border-[#0e6b47]/50" />

      {filteredUsers.length === 0 ? (
        <div className="card-light rounded-xl p-5 text-center">
          <p className="text-sm text-[#6b6359]">Vartotojų nerasta</p>
        </div>
      ) : (
        <div className="card-light rounded-xl overflow-hidden">
          {filteredUsers.map((u) => {
            const isBusy = busyUid === u.uid;
            const isMe = u.uid === currentUid;
            return (
              <div key={u.uid} className="p-3 border-b border-[#1a1410]/8 last:border-0">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center font-display text-sm flex-shrink-0"
                    style={{ backgroundColor: `${u.avatarColor}20`, color: u.avatarColor }}>
                    {u.avatarLetter}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[#1a1410] truncate">
                      {u.username} {isMe && <span className="text-[10px] text-[#6b6359]">(tu)</span>}
                    </div>
                    <div className="text-[10px] text-[#6b6359] truncate">{u.email}</div>
                  </div>
                  {u.isAdmin && (
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#0a2c4e]/10 border border-[#0a2c4e]/30 flex-shrink-0">
                      <Settings className="w-2.5 h-2.5 text-[#0a2c4e]" />
                      <span className="text-[9px] font-bold text-[#0a2c4e] uppercase tracking-wider">Admin</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row gap-2 pl-12">
                  <select
                    value={u.companyId || ''}
                    onChange={(e) => handleChangeCompany(u, e.target.value || null)}
                    disabled={isBusy}
                    className="flex-1 px-2 py-1.5 rounded border border-[#1a1410]/15 text-xs bg-white disabled:opacity-50">
                    <option value="">Be įmonės</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleToggleAdmin(u)}
                    disabled={isBusy}
                    style={u.isAdmin
                      ? { backgroundColor: '#ffffff', color: '#c8302e', border: '1px solid rgba(200, 48, 46, 0.3)' }
                      : { backgroundColor: '#0a2c4e', color: '#ffffff' }}
                    className="px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider disabled:opacity-50 flex items-center justify-center gap-1 whitespace-nowrap">
                    {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                    {u.isAdmin ? 'Atimti admin' : 'Suteikti admin'}
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
    { key: 'bestPlayer', label: 'Geriausias žaidėjas', points: 15, color: '#b8860b' },
    { key: 'topScorer', label: 'Daugiausiai įvarčių', points: 15, color: '#0e6b47' },
    { key: 'bestGoalkeeper', label: 'Geriausias vartininkas', points: 15, color: '#0a2c4e' },
    { key: 'bestYoungPlayer', label: 'Geriausias 21m. ar jaunesnis', points: 15, color: '#c8302e' },
  ];

  return (
    <div className="space-y-3">
      <div className="card-light rounded-xl p-4 bg-[#0a2c4e]/5 border-[#0a2c4e]/20">
        <p className="text-xs text-[#1a1410]">
          <strong>Pastaba:</strong> įvedus realius laimėtojus, visiems dalyviams automatiškai pridedami taškai už atitinkančias prognozes. Vardai lyginami case-insensitive (tarpai/raidžių registras nesvarbu). Tikrink vardus prieš įrašydamas.
        </p>
      </div>

      {/* Čempionas */}
      <div className="card-light rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-[#b8860b]" />
            <span className="font-display text-sm uppercase tracking-wider text-[#1a1410]">Čempionas</span>
          </div>
          <span className="text-[10px] font-bold text-[#b8860b] uppercase tracking-wider">25 tšk.</span>
        </div>
        <select value={form.champion}
          onChange={(e) => setForm({ ...form, champion: e.target.value })}
          className="w-full px-3 py-2 rounded-lg bg-white border border-[#1a1410]/15 text-sm focus:outline-none focus:border-[#0e6b47]/50">
          <option value="">— Nenustatyta —</option>
          {allCountries.map((code) => (
            <option key={code} value={code}>{teamsByCode[code].name}</option>
          ))}
        </select>
        {form.champion && (
          <div className="mt-2 text-[10px] text-[#6b6359]">
            {winnerCounts.champion} {pluralizeLt(winnerCounts.champion, ['dalyvis atspėjo', 'dalyviai atspėjo', 'dalyvių atspėjo'])} → +25 tšk. kiekvienam
          </div>
        )}
      </div>

      {/* Žaidėjų laukai */}
      {fields.map(({ key, label, points, color }) => (
        <div key={key} className="card-light rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="font-display text-sm uppercase tracking-wider text-[#1a1410]">{label}</span>
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>{points} tšk.</span>
          </div>
          <input type="text"
            value={form[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            placeholder="pvz., Lionel Messi"
            className="w-full px-3 py-2 rounded-lg bg-white border border-[#1a1410]/15 text-sm focus:outline-none focus:border-[#0e6b47]/50" />
          {form[key] && (
            <div className="mt-2 text-[10px] text-[#6b6359]">
              {winnerCounts[key]} {pluralizeLt(winnerCounts[key], ['dalyvis atspėjo', 'dalyviai atspėjo', 'dalyvių atspėjo'])} → +{points} tšk. kiekvienam
            </div>
          )}
        </div>
      ))}

      <button onClick={handleSave} disabled={saving || justSaved}
        style={justSaved
          ? { backgroundColor: '#0e6b47', color: '#ffffff' }
          : { backgroundColor: '#0a2c4e', color: '#ffffff' }}
        className="w-full py-3 rounded-xl font-display uppercase tracking-wider text-xs disabled:opacity-60 flex items-center justify-center gap-2">
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
      title: 'Sukurti demo rungtynes',
      message: 'Bus sukurtos 8 demo rungtynės. Esami m1-m8 dokumentai bus perrašyti.',
      confirmLabel: 'Sukurti',
    });
    if (!ok) return;
    setSeeding(true);
    try {
      await seedDemoMatches();
      await notify({ title: 'Pavyko', message: 'Demo rungtynės sukurtos!' });
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
      title: 'Ištrinti demo rungtynes',
      message: 'Bus ištrintos visos 8 demo rungtynės (m1-m8). Tai nepalies tikrų PFČ 2026 rungtynių (g01-g72).',
      confirmLabel: 'Ištrinti',
      variant: 'danger',
    });
    if (!ok) return;
    setSeeding(true);
    try {
      await deleteDemoMatches();
      await notify({ title: 'Pavyko', message: 'Demo rungtynės ištrintos.' });
    } catch (err) {
      await notify({ title: 'Klaida', message: err.message, variant: 'danger' });
    } finally {
      setSeeding(false);
    }
  };

  const handleSeedKnockout = async () => {
    const ok = await confirm({
      title: 'Sukurti knockout struktūrą',
      message: 'Bus sukurti 32 tušti knockout etapo match\'ai (k01-k32) be priskirtų komandų. Komandas priskirsi rankiniu būdu (per "Redaguoti") po grupių etapo, arba API sync užpildys automatiškai. Esami k01-k32 dokumentai bus perrašyti.',
      confirmLabel: 'Sukurti',
    });
    if (!ok) return;
    setSeeding(true);
    try {
      const count = await seedKnockoutStructure();
      await notify({ title: 'Pavyko', message: `Sukurti ${count} knockout etapo placeholder'iai.` });
    } catch (err) {
      await notify({ title: 'Klaida', message: err.message, variant: 'danger' });
    } finally {
      setSeeding(false);
    }
  };

  const handleSyncFromAPI = async () => {
    setSeeding(true);
    try {
      const stats = await syncResultsFromAPI();
      let msg =
        `Iš API: ${stats.total} rungtynių\n` +
        `Suderinta: ${stats.matched}\n` +
        `Atnaujinta: ${stats.updated}\n`;
      if (stats.created > 0) {
        msg += `Sukurta naujų (knockout): ${stats.created}\n`;
      }
      msg += `Be pakeitimų: ${stats.skipped}`;
      if (stats.unmatched.length > 0) {
        const shown = stats.unmatched.slice(0, 5).join('\n  • ');
        msg += `\n\nNepriderinta (${stats.unmatched.length}):\n  • ${shown}`;
        if (stats.unmatched.length > 5) msg += `\n  • ... ir dar ${stats.unmatched.length - 5}`;
        msg += `\n\n(Knockout etapo rungtynės be komandų - laukia grupių rezultatų)`;
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
    users: 'Vartotojai, admin teisės, įmonių keitimas',
  }[tab];

  return (
    <div className="space-y-4 pb-24 lg:pb-8">
      <div className="flex items-center gap-3">
        <button onClick={onClose} className="text-[#6b6359] hover:text-[#1a1410]">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="font-display text-2xl text-[#1a1410]">ADMIN</h1>
          <p className="text-xs text-[#6b6359]">{tabSubtitle}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-[#1a1410]/5">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={tab === t.id ? { backgroundColor: '#ffffff', color: '#1a1410' } : { color: '#6b6359' }}
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
      <div className="card-light rounded-xl p-4 space-y-3" style={{ borderLeft: '3px solid #0e6b47' }}>
        <div>
          <div className="font-display text-sm uppercase tracking-wider text-[#1a1410] mb-1 flex items-center gap-2">
            <Radio className="w-4 h-4 text-[#0e6b47]" />
            Rezultatų sinchronizacija
          </div>
          <p className="text-[11px] text-[#6b6359]">Paspausk po kiekvieno match dieną - automatiškai atnaujina baigtas/vykstančias rungtynes iš oficialaus FIFA tiekėjo (football-data.org).</p>
        </div>

        <button onClick={handleSyncFromAPI} disabled={seeding}
          style={{ backgroundColor: '#0e6b47', color: '#ffffff' }}
          className="w-full py-2.5 rounded-lg font-display uppercase tracking-wider text-xs disabled:opacity-50 flex items-center justify-center gap-2">
          {seeding && <Loader2 className="w-4 h-4 animate-spin" />}
          Atnaujinti rezultatus iš API
        </button>

        <p className="text-[10px] text-[#6b6359]">
          💡 Jei API neveikia - rankiniu būdu žemiau gali bet kada įvesti rezultatą.
        </p>
      </div>

      {/* Setup veiksmai - visada matomi */}
      <div className="card-light rounded-xl p-4 space-y-3">
        <div>
          <div className="font-display text-sm uppercase tracking-wider text-[#1a1410] mb-1">Rungtynių valdymas</div>
          <p className="text-[11px] text-[#6b6359]">Tikros oficialios PFČ 2026 rungtynės - 72 grupių etapas. Knockout etapas pridedamas rankiniu būdu po grupių.</p>
        </div>

        <button onClick={handleSeedWC2026} disabled={seeding}
          style={{ backgroundColor: '#0a2c4e', color: '#ffffff' }}
          className="w-full py-2.5 rounded-lg font-display uppercase tracking-wider text-xs disabled:opacity-50 flex items-center justify-center gap-2">
          {seeding && <Loader2 className="w-4 h-4 animate-spin" />}
          Įkelti PFČ 2026 rungtynes (72)
        </button>

        <button onClick={handleSeedKnockout} disabled={seeding}
          style={{ backgroundColor: '#0e6b47', color: '#ffffff' }}
          className="w-full py-2.5 rounded-lg font-display uppercase tracking-wider text-xs disabled:opacity-50 flex items-center justify-center gap-2">
          {seeding && <Loader2 className="w-4 h-4 animate-spin" />}
          Sukurti knockout struktūrą (32)
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={handleSeed} disabled={seeding}
            style={{ backgroundColor: '#6b6359', color: '#ffffff' }}
            className="py-2 rounded-lg font-display uppercase tracking-wider text-[10px] disabled:opacity-50 flex items-center justify-center gap-1">
            Sukurti 8 demo
          </button>
          <button onClick={handleDeleteDemo} disabled={seeding}
            style={{ backgroundColor: '#c8302e', color: '#ffffff' }}
            className="py-2 rounded-lg font-display uppercase tracking-wider text-[10px] disabled:opacity-50 flex items-center justify-center gap-1">
            Ištrinti demo
          </button>
        </div>
      </div>

      {matches.length === 0 && (
        <div className="card-light rounded-xl p-5">
          <p className="text-sm text-[#1a1410] font-semibold">Nėra rungtynių</p>
          <p className="text-xs text-[#6b6359] mt-1">Paspausk "Įkelti PFČ 2026 rungtynes" viršuje.</p>
        </div>
      )}

      <div className="space-y-2">
        {matches.map((m) => (
          <div key={m.id} className="card-light rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <Flag code={teamsByCode[m.home]?.code} className="w-6 h-4" />
                <span className="text-xs font-bold truncate">
                  {teamsByCode[m.home]?.name || <span className="text-[#9d9489]">TBD</span>}
                </span>
                <span className="text-[#9d9489] text-xs">vs</span>
                <span className="text-xs font-bold truncate">
                  {teamsByCode[m.away]?.name || <span className="text-[#9d9489]">TBD</span>}
                </span>
                <Flag code={teamsByCode[m.away]?.code} className="w-6 h-4" />
              </div>
              <StatusBadge status={m.status} />
            </div>
            <div className="text-[10px] text-[#6b6359] mb-2 flex items-center gap-2">
              <span>{formatKickoff(m.kickoff)}</span>
              {m.stage && m.stage !== 'group' && (
                <span className="text-[9px] font-bold text-[#0a2c4e] uppercase tracking-wider">
                  · {STAGE_LABELS[m.stage]}
                </span>
              )}
            </div>

            {editingMatch === m.id ? (
              <div className="space-y-2 pt-2 border-t border-[#1a1410]/8">
                {editForm.isKnockout && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] font-bold text-[#6b6359] uppercase tracking-wider block mb-1">Šeimininkai</label>
                      <select value={editForm.homeTeam}
                        onChange={(e) => setEditForm({ ...editForm, homeTeam: e.target.value })}
                        className="w-full px-2 py-1.5 rounded border border-[#1a1410]/15 text-xs bg-white">
                        <option value="">— TBD —</option>
                        {Object.keys(teamsByCode).sort((a, b) => teamsByCode[a].name.localeCompare(teamsByCode[b].name, 'lt')).map((code) => (
                          <option key={code} value={code}>{teamsByCode[code].name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-[#6b6359] uppercase tracking-wider block mb-1">Svečiai</label>
                      <select value={editForm.awayTeam}
                        onChange={(e) => setEditForm({ ...editForm, awayTeam: e.target.value })}
                        className="w-full px-2 py-1.5 rounded border border-[#1a1410]/15 text-xs bg-white">
                        <option value="">— TBD —</option>
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
                    className="w-16 px-2 py-1.5 rounded border border-[#1a1410]/15 text-center font-mono" />
                  <span>:</span>
                  <input type="number" min="0" max="20" value={editForm.away}
                    onChange={(e) => setEditForm({ ...editForm, away: e.target.value })}
                    className="w-16 px-2 py-1.5 rounded border border-[#1a1410]/15 text-center font-mono" />
                </div>
                <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  className="w-full px-2 py-1.5 rounded border border-[#1a1410]/15 text-sm">
                  <option value="upcoming">Būsima</option>
                  <option value="live">Vyksta (live)</option>
                  <option value="finished">Baigta</option>
                </select>
                <div className="flex gap-2">
                  <button onClick={handleSaveEdit}
                    style={{ backgroundColor: '#0e6b47', color: '#ffffff' }}
                    className="flex-1 py-1.5 rounded text-xs font-bold uppercase tracking-wider">
                    Išsaugoti
                  </button>
                  <button onClick={() => setEditingMatch(null)}
                    className="flex-1 py-1.5 rounded text-xs font-bold uppercase tracking-wider bg-white border border-[#1a1410]/15">
                    Atšaukti
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between pt-2 border-t border-[#1a1410]/8">
                {m.actualScore && (
                  <span className="font-mono text-sm font-bold">
                    Rez: {m.actualScore.home}:{m.actualScore.away}
                  </span>
                )}
                <button onClick={() => handleStartEdit(m)}
                  className="ml-auto text-xs font-bold text-[#0a2c4e] uppercase tracking-wider">
                  Redaguoti →
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="card-light rounded-xl p-4 bg-[#b8860b]/5 border-[#b8860b]/30">
        <p className="text-xs text-[#1a1410]">
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

  // Listen to auth state
  useEffect(() => {
    return onAuthChange(async (user) => {
      setAuthUser(user);
      if (user) {
        try {
          const profile = await getUserProfile(user.uid);
          setUserProfile(profile);
          const bet = await getTournamentBet(user.uid);
          if (bet) setTournamentBet({
            champion: bet.champion || null,
            bestPlayer: bet.bestPlayer || '',
            topScorer: bet.topScorer || '',
            bestGoalkeeper: bet.bestGoalkeeper || '',
            bestYoungPlayer: bet.bestYoungPlayer || '',
          });
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
  useEffect(() => {
    if (!authUser) return;
    const unsubs = [
      listenToMatches(setMatches),
      listenToUserPredictions(authUser.uid, setPredictions),
      listenToAllPredictions(setAllPredictions),
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

  // Admin screen (modal-like full screen)
  if (screen === 'admin') {
    return (
      <div className="app-bg font-body text-[#1a1410]">
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
    { id: 'bracket', icon: Award, label: 'Bracket' },
    { id: 'tournament', icon: Trophy, label: 'Prognozės' },
    { id: 'leaderboard', icon: BarChart3, label: 'Lyderiai' },
  ];

  return (
    <div className="app-bg font-body text-[#1a1410]">
      <Styles />
      <div className="max-w-md lg:max-w-5xl mx-auto min-h-screen flex flex-col">
        <header className="sticky top-0 z-40 glass-light px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <Emblem className="w-9 h-9" variant="light" />
            <div>
              <div className="font-display text-sm text-[#1a1410] leading-none tracking-wide">PFČ 2026</div>
              <div className="text-[9px] text-[#6b6359] uppercase tracking-widest mt-0.5">Totalizatorius</div>
            </div>
          </div>

          {/* Desktop: tabs viduryje header'io */}
          <nav className="hidden lg:flex flex-1 justify-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = screen === item.id;
              return (
                <button key={item.id} onClick={() => setScreen(item.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    active
                      ? 'bg-[#0e6b47]/10 text-[#0e6b47]'
                      : 'text-[#6b6359] hover:text-[#1a1410] hover:bg-[#1a1410]/5'
                  }`}>
                  <Icon className="w-4 h-4" />
                  <span className="text-xs font-bold uppercase tracking-wider">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <button onClick={() => setScreen('profile')}
            className="w-9 h-9 rounded-full flex items-center justify-center font-display text-sm transition-transform hover:scale-105 bg-white flex-shrink-0"
            style={{ color: userProfile.avatarColor, border: `1.5px solid ${userProfile.avatarColor}80` }}>
            {userProfile.avatarLetter}
          </button>
        </header>

        <main className="flex-1 px-4 pt-4">
          {screen === 'home' && <HomeScreen userProfile={userProfile} usersWithPoints={usersWithPoints}
            matches={matches} predictions={predictions} setScreen={setScreen} onUpdatePrediction={handleUpdatePrediction} />}
          {screen === 'matches' && <MatchesScreen matches={matches} predictions={predictions}
            onUpdatePrediction={handleUpdatePrediction} />}
          {screen === 'bracket' && <BracketScreen matches={matches} predictions={predictions}
            onUpdatePrediction={handleUpdatePrediction} />}
          {screen === 'tournament' && <TournamentScreen userProfile={userProfile} matches={matches}
            tournamentBet={tournamentBet} setTournamentBet={setTournamentBet} />}
          {screen === 'leaderboard' && <LeaderboardScreen usersWithPoints={usersWithPoints}
            userProfile={userProfile} />}
          {screen === 'profile' && <ProfileScreen userProfile={userProfile} usersWithPoints={usersWithPoints}
            matches={matches} predictions={predictions} tournamentResults={tournamentResults}
            onLogout={handleLogout} onOpenAdmin={() => setScreen('admin')} />}
        </main>

        {/* Mobile bottom nav - desktop'e paslėpta (header'io tabs naudojami) */}
        <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md glass-light px-2 py-2 z-30 lg:hidden">
          <div className="grid grid-cols-5 gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = screen === item.id;
              return (
                <button key={item.id} onClick={() => setScreen(item.id)}
                  className={`flex flex-col items-center gap-1 py-2 rounded-lg transition-colors ${
                    active ? 'text-[#0e6b47]' : 'text-[#6b6359] hover:text-[#1a1410]'
                  }`}>
                  <Icon className="w-5 h-5" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
      {dialog}
    </div>
  );
}
