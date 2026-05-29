// Netlify Serverless Function - tarpininkauja tarp naršyklės ir football-data.org API
// Sprendžia CORS problemą + paslepia API raktą serveryje
// URL: /.netlify/functions/sync-results
// Free tier: 125K užklausų/mėn
//
// Apsaugos sluoksniai:
// 1) Per-IP rate limit (10 req/min) - apsauga nuo abuse'o jei admin token sukompromituota
// 2) Firebase ID token verifikacija (Authorization: Bearer ...)
// 3) isAdmin check Firestore'e
// Tai užkerta nelegalų API rakto naudojimą / mūsų football-data.org rate limit'o eikvojimą.

// In-memory rate limit per IP. Resetinasi su cold start, bet pakanka apsaugai.
// Net jei state pradingsta, tikras admin'as pasiekia po keliasekundžių pauzės.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;  // 1 minutė
const RATE_LIMIT_MAX = 10;                // 10 užklausų per minutę per IP
const rateLimits = new Map();

function getClientIp(event) {
  const xff = event.headers['x-forwarded-for'] || event.headers['X-Forwarded-For'];
  if (xff) return xff.split(',')[0].trim();
  return event.headers['client-ip'] || event.headers['x-real-ip'] || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now > entry.resetTime) {
    rateLimits.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetTime - now) / 1000) };
  }
  entry.count++;
  return { allowed: true };
}

// Periodiškai išvalyti pasibaigusius rate limit įrašus (kad Map'as neaugtų be galo)
function cleanupRateLimits() {
  const now = Date.now();
  for (const [ip, entry] of rateLimits.entries()) {
    if (now > entry.resetTime) rateLimits.delete(ip);
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // === RATE LIMIT ===
  // Pirma patikra prieš jokius pajėgesnius veiksmus (token verifikaciją, API call).
  // Užkerta brute-force prieš auth + saugo mūsų API quota.
  if (Math.random() < 0.05) cleanupRateLimits(); // ~5% užklausų valymas
  const ip = getClientIp(event);
  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    return {
      statusCode: 429,
      headers: { ...headers, 'Retry-After': String(rl.retryAfter) },
      body: JSON.stringify({
        error: `Per daug užklausų. Bandyk po ${rl.retryAfter} sek.`,
      }),
    };
  }

  // === AUTENTIFIKACIJOS PATIKRA ===
  // 1) Header'yje turi būti "Authorization: Bearer <Firebase ID token>"
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Reikalingas autentifikacijos token\'as. Prisijunk iš naujo.' }),
    };
  }
  const idToken = authHeader.slice(7).trim();

  const firebaseApiKey = process.env.VITE_FIREBASE_API_KEY;
  const firebaseProjectId = process.env.VITE_FIREBASE_PROJECT_ID;
  if (!firebaseApiKey || !firebaseProjectId) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Serverio konfigūracijos klaida: Firebase env vars trūksta' }),
    };
  }

  // 2) Verifikuoti token per Firebase Identity Toolkit (REST API, be Admin SDK)
  let uid;
  try {
    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!verifyRes.ok) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Neteisingas arba pasenęs token\'as. Prisijunk iš naujo.' }),
      };
    }
    const verifyData = await verifyRes.json();
    uid = verifyData.users && verifyData.users[0] && verifyData.users[0].localId;
    if (!uid) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Vartotojo informacijos token\'e nerasta' }),
      };
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Token verifikacijos klaida: ' + err.message }),
    };
  }

  // 3) Patikrinti isAdmin per Firestore REST API (su tuo pačiu token kaip Authorization)
  // Firestore Rules užtikrina, kad vartotojas mato savo doc'ą.
  try {
    const userDocRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents/users/${uid}`,
      { headers: { Authorization: `Bearer ${idToken}` } }
    );
    if (!userDocRes.ok) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Vartotojo profilis nerastas Firestore' }),
      };
    }
    const userDocData = await userDocRes.json();
    const isAdmin = userDocData.fields &&
                    userDocData.fields.isAdmin &&
                    userDocData.fields.isAdmin.booleanValue === true;
    if (!isAdmin) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Šią funkciją gali kviesti tik admin\'as.' }),
      };
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Admin tikrinimo klaida: ' + err.message }),
    };
  }

  // === API užklausa ===
  // API raktas iš env vars (palaiko abu variantus dėl atgalinio suderinamumo)
  const apiKey = process.env.VITE_FOOTBALL_DATA_API_KEY || process.env.FOOTBALL_DATA_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'API raktas nesukonfigūruotas. Pridėk VITE_FOOTBALL_DATA_API_KEY Netlify Environment Variables.',
      }),
    };
  }

  try {
    const response = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
      headers: { 'X-Auth-Token': apiKey },
    });

    if (!response.ok) {
      let errorMsg = `API atsakė: ${response.status}`;
      if (response.status === 401 || response.status === 403) {
        errorMsg = 'Neteisingas API raktas. Patikrink VITE_FOOTBALL_DATA_API_KEY Netlify env vars.';
      } else if (response.status === 429) {
        errorMsg = 'Per daug užklausų į API. Palauk minutę.';
      } else if (response.status === 404) {
        errorMsg = 'Nerasta WC kompetencija. Galbūt football-data.org pakeitė ID.';
      }
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: errorMsg }),
      };
    }

    const data = await response.json();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Serverio klaida: ' + err.message }),
    };
  }
};
