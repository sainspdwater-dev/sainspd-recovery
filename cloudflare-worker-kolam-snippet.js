/*
 * Drop-in addition for the existing `sains-pd-api` Cloudflare Worker.
 *
 * 1. In the Worker's action router, add:
 *      case 'getReservoirData':
 *        return jsonResponse(await getReservoirData(body, env));
 *
 * 2. Copy the functions below into the same Worker source.
 * 3. Keep the existing GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, SHEET_ID and
 *    optional GAS_CACHE bindings. No secret belongs in this repository.
 */

async function getReservoirData(body, env) {
  const cacheKey = 'kolam-details:v1';
  if (!body?.forceRefresh && env.GAS_CACHE) {
    const cached = await env.GAS_CACHE.get(cacheKey, { type: 'json' });
    if (cached?.data) return { success: true, ...cached, cached: true };
  }

  const accessToken = await getGoogleAccessToken(env);
  const range = encodeURIComponent("'KOLAM DETAILS'!A:AF");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID)}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Google Sheets API ${response.status}: ${await response.text()}`);

  const payload = await response.json();
  const values = Array.isArray(payload.values) ? payload.values : [];
  const headerIndex = values.findIndex((row, index) => index < 8 && Array.isArray(row) && row.some(cell => normalizeKolamHeader(cell) === 'RESERVOIR NAME'));
  if (headerIndex < 0) throw new Error('Header RESERVOIR NAME tidak ditemui dalam KOLAM DETAILS.');

  const result = {
    headers: values[headerIndex],
    data: values.slice(headerIndex + 1).filter(row => Array.isArray(row) && row.some(cell => String(cell ?? '').trim())),
    lastUpdated: new Date().toISOString()
  };
  if (env.GAS_CACHE) await env.GAS_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 300 });
  return { success: true, ...result, cached: false };
}

function normalizeKolamHeader(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

async function getGoogleAccessToken(env) {
  if (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY || !env.SHEET_ID) {
    throw new Error('Google Sheets bindings belum lengkap.');
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(JSON.stringify({
    iss: env.GOOGLE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${claims}`;
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(String(env.GOOGLE_PRIVATE_KEY).replace(/\\n/g, '\n')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  if (!tokenResponse.ok) throw new Error(`Google OAuth ${tokenResponse.status}: ${await tokenResponse.text()}`);
  const token = await tokenResponse.json();
  return token.access_token;
}

function pemToArrayBuffer(pem) {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function base64Url(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

