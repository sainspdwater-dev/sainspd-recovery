import { mkdir, writeFile } from 'node:fs/promises';

const SHEET_ID = '1UQR0-pPfYpLVAY7_yrH9go01gmjeLxKlAijPuQN5q4I';
const SHEETS = {
  kolam: 'KOLAM DETAILS',
  masterlist: 'MASTERLIST'
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

async function readSheet(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Gagal memuat turun ${sheetName}: HTTP ${response.status}`);
  const parsed = parseCsv(await response.text());
  const headers = parsed.shift()?.map(value => value.trim()) || [];
  const rows = parsed
    .filter(row => row.some(value => String(value).trim()))
    .map(row => headers.map((_, index) => row[index] ?? ''));
  return { headers, rows };
}

const data = {};
for (const [key, sheetName] of Object.entries(SHEETS)) data[key] = await readSheet(sheetName);
const payload = {
  syncedAt: new Date().toISOString(),
  source: `https://docs.google.com/spreadsheets/d/${SHEET_ID}`,
  ...data
};

await mkdir('assets', { recursive: true });
await writeFile('assets/prototype-sheet-data.js', `window.PROTOTYPE_SHEET_DATA = ${JSON.stringify(payload)};\n`, 'utf8');
console.log(`Data prototaip disegerakkan: ${data.kolam.rows.length} KOLAM DETAILS, ${data.masterlist.rows.length} MASTERLIST.`);
