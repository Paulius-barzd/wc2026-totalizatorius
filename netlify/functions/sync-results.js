// Netlify Serverless Function - tarpininkauja tarp naršyklės ir football-data.org API
// Sprendžia CORS problemą + paslepia API raktą serveryje
// URL: /.netlify/functions/sync-results
// Free tier: 125K užklausų/mėn

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
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
