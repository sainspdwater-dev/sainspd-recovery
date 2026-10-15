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
 *      case 'deleteSheetRow':
 *        // IMPORTANT: run the existing admin-token check before this line.
 *        return jsonResponse(await deleteSheetRow(body, env));
 *      case 'deleteSheetRows':
 *        // IMPORTANT: run the existing admin-token check before this line.
 *        return jsonResponse(await deleteSheetRows(body, env));
 *      case 'uploadReservoirImage':
 *        // IMPORTANT: run the existing admin-token check before this line.
 *        return jsonResponse(await uploadReservoirImage(body, env));
 *      case 'getReservoirKmlOverrides':
 *        return jsonResponse(await getReservoirKmlOverrides(env));
 *      case 'saveReservoirKml':
 *        // IMPORTANT: run the existing admin-token check before this line.
 *        return jsonResponse(await saveReservoirKml(body, env));
 *
 * 2. Copy the functions below into the same Worker source.
 * 3. Keep the existing GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, SHEET_ID and
 *    optional GAS_CACHE bindings. For image uploads, set DRIVE_FOLDER_ID and
 *    share that Drive folder with GOOGLE_CLIENT_EMAIL as Editor. No secret
 *    belongs in this repository.
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
  // Columns W:AC (23-29) are intentionally excluded from the web table.
  'MASTERLIST': { range: 'A:V', headerRow: 3 }
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
  const formats = Array.isArray(body?.formats) ? body.formats : [];
  if ((!updates.length && !formats.length) || updates.length + formats.length > 500) throw new Error('Senarai perubahan tidak sah.');
  const data = updates.map(update => {
    const row = Number(update.row), column = Number(update.column);
    const maxColumn = sheetName === 'KOLAM DETAILS' ? 37 : 22;
    if (!Number.isInteger(row) || !Number.isInteger(column) || row < 1 || column < 1 || column > maxColumn) throw new Error('Alamat sel tidak sah.');
    if ((sheetName === 'KOLAM DETAILS' && column === 5) || (sheetName === 'MASTERLIST' && [6, 12, 13, 14].includes(column))) throw new Error('Kolum formula tidak boleh diedit melalui web.');
    return { range: `'${sheetName}'!${columnToLetter(column)}${row}`, values: [[update.value ?? '']] };
  });
  const accessToken = await getGoogleAccessToken(env);
  if (updates.length) await prepareNewSheetRows(sheetName, updates, accessToken, env);
  if (data.length) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID)}/values:batchUpdate`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data })
    });
    if (!response.ok) throw new Error(`Google Sheets API ${response.status}: ${await response.text()}`);
  }
  if (formats.length) await applySheetFormats(sheetName, formats, accessToken, env);
  await clearSheetCaches(sheetName, env);
  return { success: true, updatedCells: data.length, formattedCells: formats.length };
}

async function applySheetFormats(sheetName, formats, accessToken, env) {
  const maxColumn = sheetName === 'KOLAM DETAILS' ? 37 : 22;
  const metaResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID)}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!metaResponse.ok) throw new Error(`Google Sheets API ${metaResponse.status}: ${await metaResponse.text()}`);
  const sheet = (await metaResponse.json()).sheets?.find(item => String(item.properties?.title || '').toUpperCase() === sheetName);
  if (!sheet) throw new Error('Metadata sheet tidak ditemui.');
  const requests = formats.map(format => {
    const row = Number(format.row), column = Number(format.column);
    if (!Number.isInteger(row) || !Number.isInteger(column) || row < 1 || column < 1 || column > maxColumn) throw new Error('Alamat format sel tidak sah.');
    const userEnteredFormat = {}, fields = [];
    const textFormat = {};
    if (typeof format.bold === 'boolean') { textFormat.bold = format.bold; fields.push('textFormat.bold'); }
    if (typeof format.italic === 'boolean') { textFormat.italic = format.italic; fields.push('textFormat.italic'); }
    if (typeof format.underline === 'boolean') { textFormat.underline = format.underline; fields.push('textFormat.underline'); }
    if (typeof format.fontFamily === 'string' && /^[A-Za-z ]{1,40}$/.test(format.fontFamily)) { textFormat.fontFamily = format.fontFamily; fields.push('textFormat.fontFamily'); }
    if (Number(format.fontSize) >= 8 && Number(format.fontSize) <= 36) { textFormat.fontSize = Number(format.fontSize); fields.push('textFormat.fontSize'); }
    const textColor = hexToGoogleRgb(format.textColor); if (textColor) { textFormat.foregroundColorStyle = { rgbColor: textColor }; fields.push('textFormat.foregroundColorStyle'); }
    if (Object.keys(textFormat).length) userEnteredFormat.textFormat = textFormat;
    const fillColor = hexToGoogleRgb(format.fillColor); if (fillColor) { userEnteredFormat.backgroundColorStyle = { rgbColor: fillColor }; fields.push('backgroundColorStyle'); }
    const align = String(format.align || '').toUpperCase(); if (['LEFT', 'CENTER', 'RIGHT'].includes(align)) { userEnteredFormat.horizontalAlignment = align; fields.push('horizontalAlignment'); }
    if (!fields.length) throw new Error('Format sel kosong atau tidak sah.');
    return { repeatCell: { range: { sheetId: sheet.properties.sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: column - 1, endColumnIndex: column }, cell: { userEnteredFormat }, fields: `userEnteredFormat(${fields.join(',')})` } };
  });
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID)}:batchUpdate`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }) });
  if (!response.ok) throw new Error(`Google Sheets format API ${response.status}: ${await response.text()}`);
}

function hexToGoogleRgb(value) {
  const match = String(value || '').match(/^#([0-9a-f]{6})$/i); if (!match) return null;
  return { red: parseInt(match[1].slice(0, 2), 16) / 255, green: parseInt(match[1].slice(2, 4), 16) / 255, blue: parseInt(match[1].slice(4, 6), 16) / 255 };
}

async function prepareNewSheetRows(sheetName, updates, accessToken, env) {
  const config = EDITABLE_SHEETS[sheetName];
  const anchorColumn = sheetName === 'KOLAM DETAILS' ? 'A' : 'B';
  const valuesUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID)}/values/${encodeURIComponent(`'${sheetName}'!${anchorColumn}:${anchorColumn}`)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
  const valuesResponse = await fetch(valuesUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!valuesResponse.ok) throw new Error(`Google Sheets API ${valuesResponse.status}: ${await valuesResponse.text()}`);
  const values = (await valuesResponse.json()).values || [];
  const lastPopulatedRow = Math.max(config.headerRow, values.length);
  const targetRows = [...new Set(updates.map(update => Number(update.row)).filter(row => row > lastPopulatedRow))].sort((a, b) => a - b);
  if (!targetRows.length) return;

  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID)}?fields=sheets.properties`;
  const metaResponse = await fetch(metaUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!metaResponse.ok) throw new Error(`Google Sheets API ${metaResponse.status}: ${await metaResponse.text()}`);
  const sheet = (await metaResponse.json()).sheets?.find(item => String(item.properties?.title || '').toUpperCase() === sheetName);
  if (!sheet) throw new Error('Metadata sheet tidak ditemui.');
  const sheetId = sheet.properties.sheetId, columnCount = sheetName === 'KOLAM DETAILS' ? 37 : 22;
  const requests = [];
  const maxTarget = Math.max(...targetRows);
  if (maxTarget > Number(sheet.properties.gridProperties?.rowCount || 0)) requests.push({ appendDimension: { sheetId, dimension: 'ROWS', length: maxTarget - Number(sheet.properties.gridProperties?.rowCount || 0) } });
  for (const row of targetRows) {
    const sourceStart = Math.max(config.headerRow, lastPopulatedRow) - 1, targetStart = row - 1;
    for (const pasteType of ['PASTE_FORMAT', 'PASTE_DATA_VALIDATION', 'PASTE_FORMULA']) {
      requests.push({ copyPaste: { source: { sheetId, startRowIndex: sourceStart, endRowIndex: sourceStart + 1, startColumnIndex: 0, endColumnIndex: columnCount }, destination: { sheetId, startRowIndex: targetStart, endRowIndex: targetStart + 1, startColumnIndex: 0, endColumnIndex: columnCount }, pasteType, pasteOrientation: 'NORMAL' } });
    }
    if (sheetName === 'KOLAM DETAILS') {
      const type = String(updates.find(update => Number(update.row) === row && Number(update.column) === 34)?.value || '').toUpperCase();
      const balancing = type === 'KOLAM BALANCING';
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: targetStart, endRowIndex: targetStart + 1, startColumnIndex: 0, endColumnIndex: columnCount }, cell: { userEnteredFormat: { backgroundColorStyle: { rgbColor: balancing ? { red: 0.698, green: 0.631, blue: 0.780 } : { red: 1, green: 1, blue: 1 } }, textFormat: { bold: balancing } } }, fields: 'userEnteredFormat(backgroundColorStyle,textFormat.bold)' } });
    }
  }
  const prepareResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID)}:batchUpdate`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }) });
  if (!prepareResponse.ok) throw new Error(`Google Sheets API ${prepareResponse.status}: ${await prepareResponse.text()}`);
}

async function deleteSheetRow(body, env) {
  return deleteSheetRows({ ...body, rows: [{ row: body?.row, confirmColumn: body?.confirmColumn, confirmName: body?.confirmName }] }, env);
}

async function deleteSheetRows(body, env) {
  const sheetName = String(body?.sheetName || '').trim().toUpperCase();
  const config = EDITABLE_SHEETS[sheetName];
  if (!config) throw new Error('Sheet tidak dibenarkan.');
  const maxColumn = sheetName === 'KOLAM DETAILS' ? 37 : 22;
  const rows = Array.isArray(body?.rows) ? body.rows.map(item => ({ row: Number(item?.row), confirmColumn: Number(item?.confirmColumn), confirmName: String(item?.confirmName || '').trim() })) : [];
  if (!rows.length || rows.length > 100 || new Set(rows.map(item => item.row)).size !== rows.length || rows.some(item => !Number.isInteger(item.row) || item.row <= config.headerRow || !Number.isInteger(item.confirmColumn) || item.confirmColumn < 1 || item.confirmColumn > maxColumn || !item.confirmName)) throw new Error('Pengesahan baris tidak sah.');
  const accessToken = await getGoogleAccessToken(env);
  await Promise.all(rows.map(async item => {
    const confirmRange = encodeURIComponent(`'${sheetName}'!${columnToLetter(item.confirmColumn)}${item.row}`);
    const verifyResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID)}/values/${confirmRange}?valueRenderOption=FORMATTED_VALUE`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!verifyResponse.ok) throw new Error(`Google Sheets API ${verifyResponse.status}: ${await verifyResponse.text()}`);
    const actual = String((await verifyResponse.json()).values?.[0]?.[0] || '').replace(/\s+/g, ' ').trim().toUpperCase();
    if (actual !== item.confirmName.replace(/\s+/g, ' ').trim().toUpperCase()) throw new Error(`Nama pengesahan ${item.confirmName} tidak sepadan dengan rekod Google Sheet. Muat semula data dan cuba lagi.`);
  }));
  const metaResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID)}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!metaResponse.ok) throw new Error(`Google Sheets API ${metaResponse.status}: ${await metaResponse.text()}`);
  const sheet = (await metaResponse.json()).sheets?.find(item => String(item.properties?.title || '').toUpperCase() === sheetName);
  if (!sheet) throw new Error('Metadata sheet tidak ditemui.');
  const requests = rows.sort((a, b) => b.row - a.row).map(item => ({ deleteDimension: { range: { sheetId: sheet.properties.sheetId, dimension: 'ROWS', startIndex: item.row - 1, endIndex: item.row } } }));
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.SHEET_ID)}:batchUpdate`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }) });
  if (!response.ok) throw new Error(`Google Sheets API ${response.status}: ${await response.text()}`);
  await clearSheetCaches(sheetName, env);
  return { success: true, deletedRows: rows.map(item => item.row) };
}

async function uploadReservoirImage(body, env) {
  if (!env.DRIVE_FOLDER_ID) throw new Error('Binding DRIVE_FOLDER_ID belum ditetapkan pada Worker.');
  const reservoirName = String(body?.reservoirName || '').trim(), reservoirCode = String(body?.reservoirCode || '').trim();
  const sourceName = String(body?.fileName || '').trim(), dataUrl = String(body?.dataUrl || '');
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!reservoirName || !reservoirCode || !sourceName || !match) throw new Error('Maklumat gambar tidak sah.');
  const bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0));
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('Saiz gambar mesti antara 1 bait dan 5 MB.');
  const extension = match[1].split('/')[1].replace('jpeg', 'jpg');
  const safeBase = `${reservoirCode}-${reservoirName}`.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  const fileName = `${safeBase}.${extension}`;
  const accessToken = await getGoogleAccessToken(env);
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name: fileName, parents: [env.DRIVE_FOLDER_ID] })], { type: 'application/json' }));
  form.append('file', new Blob([bytes], { type: match[1] }), fileName);
  const uploadResponse = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form });
  if (!uploadResponse.ok) throw new Error(`Google Drive API ${uploadResponse.status}: ${await uploadResponse.text()}`);
  const file = await uploadResponse.json();
  const permissionResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/permissions`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'reader', type: 'anyone' }) });
  if (!permissionResponse.ok) throw new Error(`Gambar dimuat naik tetapi akses paparan gagal: ${await permissionResponse.text()}`);
  return { success: true, fileId: file.id, fileName: file.name, webViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`, imageUrl: `https://drive.google.com/thumbnail?id=${file.id}&sz=w1600` };
}

async function clearSheetCaches(sheetName, env) {
  if (!env.GAS_CACHE) return;
  await Promise.all([
    env.GAS_CACHE.delete(`sheet-table:${sheetName}:v1`),
    sheetName === 'KOLAM DETAILS' ? env.GAS_CACHE.delete('kolam-details:v1') : Promise.resolve(),
    env.GAS_CACHE.put('DATA_VERSION', Date.now().toString())
  ]);
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
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
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
