import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const html = await readFile('index_dashboard.html', 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(value => value.trim());
for (const source of scripts) new Function(source);
for (const required of ['demand-layer-kolam', 'demand-layer-secondary', 'saveReservoirDetails', 'handleReservoirKmlUpload', 'openSidebarFromEdge', 'canonicalStatusValue', 'isReservoirFormulaHeader', 'reservoir-detail-footer']) {
  if (!html.includes(required)) throw new Error(`Missing requested dashboard feature: ${required}`);
}
const workerSource = await readFile('cloudflare-worker-kolam-snippet.js', 'utf8');
new Function(workerSource);
for (const required of ['saveReservoirKml', 'getReservoirKmlOverrides', 'updateSheetCells']) {
  if (!workerSource.includes(required)) throw new Error(`Missing Worker persistence function: ${required}`);
}
const manifestSource = await readFile('assets/kml-kolam-manifest.js', 'utf8');
new Function(manifestSource);
const manifestContext = { window: {} };
new Function('window', manifestSource)(manifestContext.window);
const manifest = manifestContext.window.KML_KOLAM_MANIFEST || [];
const prototypeDataSource = await readFile('assets/prototype-sheet-data.js', 'utf8');
new Function(prototypeDataSource);
const prototypeContext = { window: {} };
new Function('window', prototypeDataSource)(prototypeContext.window);
const prototypeData = prototypeContext.window.PROTOTYPE_SHEET_DATA;
if (prototypeData?.kolam?.rows?.length !== 74) throw new Error(`Expected 74 KOLAM DETAILS rows, found ${prototypeData?.kolam?.rows?.length || 0}`);
if (!prototypeData?.kolam?.headers?.includes('CAPACITY ST (ML)')) throw new Error('Expected updated CAPACITY ST (ML) header');
if (prototypeData?.masterlist?.rows?.length !== 548) throw new Error(`Expected 548 MASTERLIST rows, found ${prototypeData?.masterlist?.rows?.length || 0}`);

async function countKml(directory) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) count += entry.isDirectory() ? await countKml(path.join(directory, entry.name)) : Number(entry.name.toLowerCase().endsWith('.kml'));
  return count;
}

const fileCount = await countKml('assets/kml-kolam');
const manifestCount = (manifestSource.match(/path:\s*'/g) || []).length;
if (fileCount !== manifestCount) throw new Error(`KML manifest mismatch: ${fileCount} files, ${manifestCount} manifest entries`);

const canonicalName = value => String(value || '')
  .replace(/<br\s*\/?\s*>/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, ' ')
  .trim()
  .replace(/\bTMN\b/g, 'TAMAN')
  .replace(/\bBKT\b/g, 'BUKIT')
  .replace(/\bKG\b/g, 'KAMPUNG')
  .replace(/\bTELUK\b/g, 'TELOK')
  .trim();
const reservoirNames = prototypeData.kolam.rows.map(row => row[0]);
const namesMatch = (left, right) => {
  const a = canonicalName(left), b = canonicalName(right);
  return a === b || (Math.min(a.length, b.length) >= 8 && (a.includes(b) || b.includes(a)));
};
const unmatchedKml = manifest.filter(item => !reservoirNames.some(name => namesMatch(item.name, name)));
if (unmatchedKml.length) throw new Error(`Unmatched KML names: ${unmatchedKml.map(item => item.name).join(', ')}`);
const distinctNameKeys = [...new Set(manifest.map(item => canonicalName(item.name)))].sort();
const colours = distinctNameKeys.map((_, index) => `hsl(${Math.round((index * 137.508) % 360)} 76% 42%)`);
if (new Set(colours).size !== colours.length) throw new Error('KML colour generator produced a duplicate colour');

console.log(`Checks passed: ${scripts.length} inline script, ${fileCount} matched KML files with ${colours.length} unique reservoir colours, ${prototypeData.kolam.rows.length} KOLAM DETAILS rows, ${prototypeData.masterlist.rows.length} MASTERLIST rows.`);
