import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHEET_ID = '1UQR0-pPfYpLVAY7_yrH9go01gmjeLxKlAijPuQN5q4I';
const SHEETS = {
  kolam: 'KOLAM DETAILS',
  masterlist: 'MASTERLIST'
};

const RELATIONSHIP_HEADERS = ['KOD KOLAM', 'JENIS KOLAM', 'KOLAM BALANCING UTAMA', 'KOD OUTLET', 'REKOD DEMAND UTAMA'];

function canonicalName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ').trim()
    .replace(/\bTMN\b/g, 'TAMAN').replace(/\bBKT\b/g, 'BUKIT')
    .replace(/\bKG\b/g, 'KAMPUNG').replace(/\bTELUK\b/g, 'TELOK').trim();
}

function ensureKolamRelationships(table) {
  const headers = [...table.headers];
  RELATIONSHIP_HEADERS.forEach(header => { if (!headers.includes(header)) headers.push(header); });
  const indexes = Object.fromEntries(headers.map((header, index) => [header, index]));
  const rows = table.rows.map(row => headers.map((_, index) => row[index] ?? ''));
  const supplyNames = new Set(rows.map(row => canonicalName(row[indexes['SUPPLY FROM']])).filter(Boolean));
  const balancingRows = [];
  let balancingNumber = 1, serviceNumber = 1;

  rows.forEach(row => {
    const explicitType = String(row[indexes['JENIS KOLAM']] || '').trim().toUpperCase();
    const type = explicitType || (supplyNames.has(canonicalName(row[indexes['RESERVOIR NAME']])) ? 'KOLAM BALANCING' : 'KOLAM SERVIS');
    row[indexes['JENIS KOLAM']] = type;
    if (!String(row[indexes['KOD KOLAM']] || '').trim()) {
      const prefix = type === 'KOLAM BALANCING' ? 'BR' : 'SR';
      const number = type === 'KOLAM BALANCING' ? balancingNumber++ : serviceNumber++;
      row[indexes['KOD KOLAM']] = `${prefix}-${String(number).padStart(3, '0')}`;
    }
    if (type === 'KOLAM BALANCING') balancingRows.push(row);
  });

  rows.forEach(row => {
    if (row[indexes['JENIS KOLAM']] === 'KOLAM BALANCING') { row[indexes['KOLAM BALANCING UTAMA']] = ''; return; }
    if (String(row[indexes['KOLAM BALANCING UTAMA']] || '').trim()) return;
    const supply = row[indexes['SUPPLY FROM']];
    const parent = balancingRows.find(candidate => canonicalName(candidate[indexes['RESERVOIR NAME']]) === canonicalName(supply));
    row[indexes['KOLAM BALANCING UTAMA']] = parent
      ? parent[indexes['KOD KOLAM']]
      : (String(supply || '').trim() ? `EXT-${canonicalName(supply).replace(/\s+/g, '-')}` : '');
  });

  const serviceRows = rows.filter(row => row[indexes['JENIS KOLAM']] === 'KOLAM SERVIS');
  const tagCounts = new Map();
  serviceRows.forEach(row => {
    const tag = String(row[indexes['TAGGING NO PAAB']] || '').trim().toUpperCase();
    if (tag) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  });
  const groupCodes = new Map();
  let outletNumber = 1;
  serviceRows.forEach((row, rowIndex) => {
    if (String(row[indexes['KOD OUTLET']] || '').trim()) return;
    const name = canonicalName(row[indexes['RESERVOIR NAME']]);
    const tag = String(row[indexes['TAGGING NO PAAB']] || '').trim().toUpperCase();
    const groupKey = name.startsWith('BANDAR SPRING HILL') ? 'BANDAR SPRING HILL' : (tag && tagCounts.get(tag) > 1 ? `TAG:${tag}` : `ROW:${rowIndex}`);
    if (!groupCodes.has(groupKey)) groupCodes.set(groupKey, `OUT-${String(outletNumber++).padStart(3, '0')}`);
    row[indexes['KOD OUTLET']] = groupCodes.get(groupKey);
  });
  const groups = new Map();
  serviceRows.forEach(row => {
    const code = String(row[indexes['KOD OUTLET']] || '').trim().toUpperCase();
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(row);
  });
  groups.forEach(group => {
    let primary = group.find(row => String(row[indexes['REKOD DEMAND UTAMA']] || '').trim().toUpperCase() === 'YA');
    if (!primary) primary = group.find(row => Number(String(row[indexes['DEMAND PER MONTH (M3)']] || '').replace(/,/g, '')) > 0) || group[0];
    group.forEach(row => { if (!String(row[indexes['REKOD DEMAND UTAMA']] || '').trim()) row[indexes['REKOD DEMAND UTAMA']] = row === primary ? 'YA' : 'TIDAK'; });
  });
  return { headers, rows };
}

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

export async function syncSheetData(options = {}) {
  const outputRoot = path.resolve(options.outputRoot || process.cwd());
  const data = {};
  for (const [key, sheetName] of Object.entries(SHEETS)) data[key] = await readSheet(sheetName);
  data.kolam = ensureKolamRelationships(data.kolam);
  const payload = {
    syncedAt: new Date().toISOString(),
    source: `https://docs.google.com/spreadsheets/d/${SHEET_ID}`,
    ...data
  };

  const assetsDirectory = path.join(outputRoot, 'assets');
  await mkdir(assetsDirectory, { recursive: true });
  await writeFile(path.join(assetsDirectory, 'prototype-sheet-data.js'), `window.PROTOTYPE_SHEET_DATA = ${JSON.stringify(payload)};\n`, 'utf8');
  return payload;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const payload = await syncSheetData();
  console.log(`Data prototaip disegerakkan: ${payload.kolam.rows.length} KOLAM DETAILS, ${payload.masterlist.rows.length} MASTERLIST.`);
}
