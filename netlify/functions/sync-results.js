// Netlify Serverless Function - tarpininkauja tarp naršyklės ir football-data.org API
// Sprendžia CORS problemą + paslepia API raktą serveryje
// URL: /.netlify/functions/sync-results
// Free tier: 125K užklausų/mėn
//
// Autentifikacija: reikalauja Firebase ID token Authorization header'yje + isAdmin check.
// Tai užkerta nelegalų API rakto naudojimą / mūsų football-data.org rate limit'o eikvojimą.

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
