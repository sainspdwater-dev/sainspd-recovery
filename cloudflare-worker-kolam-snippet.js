/*
 * Drop-in addition for the existing `sains-pd-api` Cloudflare Worker.
 *
 * 1. In the Worker's action router, add:
 *      case 'getReservoirData':
 *        return jsonResponse(await getReservoirData(body, env));
 *      case 'getSheetTable':
 *        return jsonResponse(await getSheetTable(body, env));
 *      case 'updateSheetCells':
 *        // IMPORTANT: run the existing admin-token check before this line.
 *        return jsonResponse(await updateSheetCells(body, env));
 *      case 'getReservoirKmlOverrides':
 *        return jsonResponse(await getReservoirKmlOverrides(env));
 *      case 'saveReservoirKml':
 *        // IMPORTANT: run the existing admin-token check before this line.
 *        return jsonResponse(await saveReservoirKml(body, env));
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
  const range = encodeURIComponent("'KOLAM DETAILS'!A:AK");
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

const EDITABLE_SHEETS = {
  'KOLAM DETAILS': { range: 'A:AK', headerRow: 1 },
  'MASTERLIST': { range: 'A:S', headerRow: 3 }
};

async function getSheetTable(body, env) {
  const sheetName = String(body?.sheetName || '').trim().toUpperCase();
  const config = EDITABLE_SHEETS[sheetName];
  if (!config) throw new Error('Sheet tidak dibenarkan.');
  const cacheKey = `sheet-table:${sheetName}:v1`;
  if (!body?.forceRefresh && env.GAS_CACHE) {
    const cached = await env.GAS_CACHE.get(cacheKey, { type: 'json' });
    if (cached?.data) return { success: true, ...cached, cached: true };
  }
  const accessToken = await getGoogleAccessToken(env);
  const range = encodeURIComponent(`'${sheetName}'!${config.range}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID)}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Google Sheets API ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  const values = Array.isArray(payload.values) ? payload.values : [];
  const headerIndex = config.headerRow - 1;
  const result = {
    headers: values[headerIndex] || [],
    data: values.slice(headerIndex + 1).filter(row => Array.isArray(row) && row.some(cell => String(cell ?? '').trim())),
    headerRow: config.headerRow,
    lastUpdated: new Date().toISOString()
  };
  if (env.GAS_CACHE) await env.GAS_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 300 });
  return { success: true, ...result, cached: false };
}

async function updateSheetCells(body, env) {
  const sheetName = String(body?.sheetName || '').trim().toUpperCase();
  if (!EDITABLE_SHEETS[sheetName]) throw new Error('Sheet tidak dibenarkan.');
  const updates = Array.isArray(body?.updates) ? body.updates : [];
  if (!updates.length || updates.length > 500) throw new Error('Senarai perubahan tidak sah.');
  const data = updates.map(update => {
    const row = Number(update.row), column = Number(update.column);
    const maxColumn = sheetName === 'KOLAM DETAILS' ? 37 : 19;
    if (!Number.isInteger(row) || !Number.isInteger(column) || row < 1 || column < 1 || column > maxColumn) throw new Error('Alamat sel tidak sah.');
    return { range: `'${sheetName}'!${columnToLetter(column)}${row}`, values: [[update.value ?? '']] };
  });
  const accessToken = await getGoogleAccessToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID)}/values:batchUpdate`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data })
  });
  if (!response.ok) throw new Error(`Google Sheets API ${response.status}: ${await response.text()}`);
  if (env.GAS_CACHE) {
    await Promise.all([
      env.GAS_CACHE.delete(`sheet-table:${sheetName}:v1`),
      sheetName === 'KOLAM DETAILS' ? env.GAS_CACHE.delete('kolam-details:v1') : Promise.resolve()
    ]);
  }
  return { success: true, updatedCells: data.length };
}

async function saveReservoirKml(body, env) {
  if (!env.GAS_CACHE) throw new Error('Binding GAS_CACHE diperlukan untuk simpanan KML.');
  const reservoirName = String(body?.reservoirName || '').trim();
  const fileName = String(body?.fileName || '').trim();
  const kmlText = String(body?.kmlText || '');
  if (!reservoirName || !fileName.toLowerCase().endsWith('.kml')) throw new Error('Nama kolam atau fail KML tidak sah.');
  if (!kmlText || kmlText.length > 8 * 1024 * 1024 || !/<coordinates[\s>]/i.test(kmlText)) throw new Error('Kandungan KML tidak sah atau melebihi 8 MB.');
  const id = normalizeKolamHeader(reservoirName).replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const storageKey = `reservoir-kml:${id}`;
  const entry = { name: reservoirName, supply: String(body?.supplyFrom || ''), fileName, text: kmlText, updatedAt: new Date().toISOString() };
  await env.GAS_CACHE.put(storageKey, JSON.stringify(entry));
  const indexKey = 'reservoir-kml:index:v1';
  const current = await env.GAS_CACHE.get(indexKey, { type: 'json' });
  const keys = Array.isArray(current) ? current.filter(key => key !== storageKey) : [];
  keys.push(storageKey);
  await env.GAS_CACHE.put(indexKey, JSON.stringify(keys.slice(-100)));
  return { success: true, name: reservoirName, fileName, updatedAt: entry.updatedAt };
}

async function getReservoirKmlOverrides(env) {
  if (!env.GAS_CACHE) return { success: true, items: [] };
  const keys = await env.GAS_CACHE.get('reservoir-kml:index:v1', { type: 'json' });
  const items = await Promise.all((Array.isArray(keys) ? keys : []).map(key => env.GAS_CACHE.get(key, { type: 'json' })));
  return { success: true, items: items.filter(item => item?.name && item?.text) };
}

function columnToLetter(column) {
  let value = column, result = '';
  while (value > 0) { value -= 1; result = String.fromCharCode(65 + (value % 26)) + result; value = Math.floor(value / 26); }
  return result;
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
    scope: 'https://www.googleapis.com/auth/spreadsheets',
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
