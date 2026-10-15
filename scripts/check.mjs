import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const html = await readFile('index_dashboard.html', 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(value => value.trim());
for (const source of scripts) new Function(source);
for (const required of ['demand-layer-kolam', 'demand-layer-secondary', 'saveReservoirDetails', 'handleReservoirKmlUpload', 'openSidebarFromEdge', 'canonicalStatusValue', 'isReservoirFormulaHeader', 'isReservoirDropdownHeader', 'setSuctionTankPresence', 'demandMetricRows', 'reservoir-detail-footer']) {
  if (!html.includes(required)) throw new Error(`Missing requested dashboard feature: ${required}`);
}
const workerSource = await readFile('cloudflare-worker-kolam-snippet.js', 'utf8');
new Function(workerSource);
for (const required of ['saveReservoirKml', 'getReservoirKmlOverrides', 'updateSheetCells', 'deleteSheetRow', 'deleteSheetRows', 'uploadReservoirImage', 'prepareNewSheetRows', 'applySheetFormats']) {
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
if ((prototypeData?.kolam?.rows?.length || 0) < 75) throw new Error(`Expected at least 75 KOLAM DETAILS rows, found ${prototypeData?.kolam?.rows?.length || 0}`);
if (!prototypeData?.kolam?.headers?.includes('CAPACITY ST (ML)')) throw new Error('Expected updated CAPACITY ST (ML) header');
for (const header of ['KOD KOLAM', 'JENIS KOLAM', 'KOLAM BALANCING UTAMA', 'KOD OUTLET', 'REKOD DEMAND UTAMA']) {
  if (!prototypeData?.kolam?.headers?.includes(header)) throw new Error(`Expected KOLAM DETAILS relationship header ${header}`);
}
if ((prototypeData?.masterlist?.rows?.length || 0) < 500) throw new Error(`Expected at least 500 MASTERLIST rows, found ${prototypeData?.masterlist?.rows?.length || 0}`);
if (prototypeData.masterlist.headers.length !== 29 || prototypeData.masterlist.headers.slice(22, 29).some(header => String(header || '').trim())) throw new Error('Expected blank MASTERLIST columns 23 to 29');
if (!prototypeData.masterlist.rows.some(row => row.some(value => String(value || '').includes('m³')))) throw new Error('Expected MASTERLIST m³ display values from Google Sheet');
if (!prototypeData.masterlist.rows.some(row => row.some(value => /(?:^|\s)-?[\d,]+(?:\.\d+)?\sG$/.test(String(value || '').trim())))) throw new Error('Expected MASTERLIST gallon values with G unit from Google Sheet');
const bukitTunggalFamily = prototypeData.kolam.rows.filter(row => ['BUKIT TUNGGAL', 'Tmn Desa PD 1', 'Tmn Desa PD 2'].includes(String(row[0] || '').trim()));
if (bukitTunggalFamily.length !== 3) throw new Error('Expected BUKIT TUNGGAL parent with Tmn Desa PD 1 and Tmn Desa PD 2');
if (!bukitTunggalFamily.every(row => String(row[1] || '').trim() === 'BUKIT TUNGGAL')) throw new Error('Expected current BUKIT TUNGGAL supply mapping from Google Sheet');
const bukitKunyitParent = prototypeData.kolam.rows.find(row => String(row[0] || '').trim() === 'BUKIT KUNYIT');
if (String(bukitKunyitParent?.[1] || '').trim() !== 'BUKIT KUNYIT') throw new Error('Expected BUKIT KUNYIT to be its own supply parent');
const supplyFilterValues = new Set(prototypeData.kolam.rows.map(row => String(row[1] || '').trim()).filter(Boolean));
if (supplyFilterValues.has('SAWAH RAJA')) throw new Error('SAWAH RAJA should no longer appear in the Supply From filter');

const kolamHeaderIndex = Object.fromEntries(prototypeData.kolam.headers.map((header, index) => [header, index]));
const reservoirCodes = prototypeData.kolam.rows.map(row => String(row[kolamHeaderIndex['KOD KOLAM']] || '').trim()).filter(Boolean);
if (new Set(reservoirCodes).size !== prototypeData.kolam.rows.length) throw new Error('Expected a unique KOD KOLAM for every reservoir row');
const balancingRows = prototypeData.kolam.rows.filter(row => String(row[kolamHeaderIndex['JENIS KOLAM']] || '').trim() === 'KOLAM BALANCING');
if (balancingRows.length !== 6) throw new Error(`Expected 6 explicit balancing reservoirs, found ${balancingRows.length}`);
if (balancingRows.some(row => String(row[kolamHeaderIndex['KOLAM BALANCING UTAMA']] || '').trim())) throw new Error('Balancing reservoirs must not have a parent code');
const balancingCodes = new Set(balancingRows.map(row => String(row[kolamHeaderIndex['KOD KOLAM']] || '').trim()));
const invalidServiceParent = prototypeData.kolam.rows.find(row => String(row[kolamHeaderIndex['JENIS KOLAM']] || '').trim() === 'KOLAM SERVIS' && !balancingCodes.has(String(row[kolamHeaderIndex['KOLAM BALANCING UTAMA']] || '').trim()) && !String(row[kolamHeaderIndex['KOLAM BALANCING UTAMA']] || '').startsWith('EXT-'));
if (invalidServiceParent) throw new Error(`Invalid service parent for ${invalidServiceParent[kolamHeaderIndex['RESERVOIR NAME']]}`);
const springHillRows = prototypeData.kolam.rows.filter(row => String(row[kolamHeaderIndex['RESERVOIR NAME']] || '').trim().toUpperCase().startsWith('BANDAR SPRING HILL'));
if (springHillRows.length !== 5) throw new Error(`Expected 5 Bandar Spring Hill reservoir rows, found ${springHillRows.length}`);
if (new Set(springHillRows.map(row => row[kolamHeaderIndex['KOD OUTLET']])).size !== 1) throw new Error('Expected all Bandar Spring Hill reservoirs to share one outlet code');
if (springHillRows.filter(row => String(row[kolamHeaderIndex['REKOD DEMAND UTAMA']] || '').trim() === 'YA').length !== 1) throw new Error('Expected exactly one Bandar Spring Hill primary demand row');
const numberFromSheet = value => Number(String(value || '').replace(/,/g, '')) || 0;
const bukitTunggalParent = prototypeData.kolam.rows.find(row => String(row[kolamHeaderIndex['RESERVOIR NAME']] || '').trim() === 'BUKIT TUNGGAL');
if (!bukitTunggalParent) throw new Error('Expected BUKIT TUNGGAL balancing row from Google Sheet row 2');
const bukitTunggalExpected = {
  demandMonth: 35795.1,
  demandDay: 1193.17,
  connections: 1511,
  serviceCapacityMl: 6.83,
};
const bukitTunggalActual = {
  demandMonth: numberFromSheet(bukitTunggalParent[kolamHeaderIndex['DEMAND PER MONTH (M3)']]),
  demandDay: numberFromSheet(bukitTunggalParent[kolamHeaderIndex['DEMAND PER DAY (M3)']]),
  connections: numberFromSheet(bukitTunggalParent[kolamHeaderIndex['TOTAL CONNECTION']]),
  serviceCapacityMl: numberFromSheet(bukitTunggalParent[kolamHeaderIndex['SERVICE RESERVOIR CAPACITY (ML)']]),
};
for (const [key, expected] of Object.entries(bukitTunggalExpected)) {
  if (bukitTunggalActual[key] !== expected) throw new Error(`Expected BUKIT TUNGGAL ${key} ${expected} from balancing row, received ${bukitTunggalActual[key]}`);
}
if (!html.includes("capacityRows.reduce((sum, item) => sum + Number(item.serviceCapacityMl || 0), 0)")) throw new Error('Expected capacity KPI to preserve physical reservoir capacity rows');
if (!html.includes('collapseOutletDemandRows(filteredReservoirRows)')) throw new Error('Expected outlet demand grouping to prevent duplicate demand totals');
if (!html.includes('.tank-marker.balancing { background: #7c3aed; }')) throw new Error('Expected purple balancing-reservoir map marker style');
if (!html.includes("isBalancingReservoir(r) ? 'balancing' : reservoirStatusKind(r)")) throw new Error('Expected balancing reservoirs to use the purple marker class');
if (!html.includes('Balancing Reservoir</span>')) throw new Error('Expected balancing-reservoir map legend');
if (!html.includes("const MASTERLIST_HIDDEN_COLUMN_INDEXES = new Set([0, 22, 23, 24, 25, 26, 27, 28])")) throw new Error('Expected BIL and MASTERLIST columns 23 to 29 hidden');
if (!html.includes("['LRA', 0], ['KOLAM UTAMA', 1], ['SECONDARY SUPPLY', 2], ['KAWASAN', 3]")) throw new Error('Expected MASTERLIST frozen columns from LRA through KAWASAN');
if (!html.includes("['LRA', 'KOLAM UTAMA', 'SECONDARY SUPPLY', 'NAMA KOLAM']")) throw new Error('Expected MASTERLIST Google Sheet dropdown columns');
for (const zoom of [50, 75, 100, 125, 150, 175]) if (!html.includes(`data-masterlist-zoom="${zoom}"`)) throw new Error(`Expected MASTERLIST ${zoom}% zoom control`);
for (const zoom of [50, 75, 100, 125, 150, 175]) if (!html.includes(`data-kolam-zoom="${zoom}"`)) throw new Error(`Expected KOLAM DETAILS ${zoom}% zoom control`);
if (!html.includes('#kolam-sheet-table { zoom: var(--kolam-zoom, 1); }')) throw new Error('Expected KOLAM DETAILS table zoom styling');
if (!html.includes('overflow-y: scroll; scrollbar-gutter: stable;')) throw new Error('Expected always-visible side scrollbar for sheet tables');
if (!html.includes('Clear Contents') || !html.includes('Insert New Row') || !html.includes('Delete This Row')) throw new Error('Expected English spreadsheet context menu');
if (!html.includes('function setKolamZoom(percent)')) throw new Error('Expected KOLAM DETAILS zoom handler');
if (!html.includes('function loadDeployedSnapshotFallback(reason = \'\')') || !html.includes('rekod snapshot terakhir')) throw new Error('Expected hosted snapshot fallback when the live Worker is unavailable');
if (!html.includes("openAddReservoirModal('balancing')") || !html.includes("openAddReservoirModal('service')")) throw new Error('Expected popup add buttons for balancing and service reservoirs');
if (!html.includes('function confirmDeleteSheetRow()') || !html.includes('delete-row-confirmation')) throw new Error('Expected typed row-delete confirmation');
if (!html.includes("openDeleteSelectedModal('kolam')") || !html.includes("openDeleteSelectedModal('masterlist')")) throw new Error('Expected toolbar delete buttons for selected rows');
if (!html.includes('class="sheet-select-column"') || !html.includes('toggleAllVisibleSheetRows')) throw new Error('Expected row selection checkboxes beside sequence numbers');
if (!html.includes('function openSheetContextMenu(') || !html.includes('function sheetClipboardAction(')) throw new Error('Expected spreadsheet right-click menu');
if (!html.includes('function applySheetFormat(') || !html.includes('sheetRibbonMarkup')) throw new Error('Expected spreadsheet formatting ribbon');
if (html.includes('sheet-action-column')) throw new Error('Per-row delete action column should be removed');
if (!html.includes("[11, 12, 13].includes(Number(columnIndex))")) throw new Error('Expected MASTERLIST formula columns L to N to be locked');
if (!html.includes('class="sheet-sequence">NO.</th>')) throw new Error('Expected MASTERLIST sequence column');
if (!html.includes("const KOLAM_TYPE_BALANCING = 'KOLAM BALANCING'")) throw new Error('Expected explicit reservoir type support');
if (!workerSource.includes("'KOLAM DETAILS': { range: 'A:AK'")) throw new Error('Expected Worker range to include relationship columns through AK');
if (!workerSource.includes("'MASTERLIST': { range: 'A:V'")) throw new Error('Expected Worker MASTERLIST range to retain columns 1 to 22 only');
const sirusa2Rows = prototypeData.kolam.rows.filter(row => String(row[kolamHeaderIndex['SUPPLY FROM']] || '').trim() === 'SIRUSA 2');
const sirusa2Parent = prototypeData.kolam.rows.find(row => String(row[kolamHeaderIndex['RESERVOIR NAME']] || '').trim() === 'SIRUSA 2');
if (sirusa2Rows.length !== 5 || !sirusa2Parent) throw new Error('Expected SIRUSA 2 parent and four service-level rows');
const sirusa2RawDaily = sirusa2Rows.reduce((total, row) => total + numberFromSheet(row[kolamHeaderIndex['DEMAND PER DAY (M3)']]), 0);
const sirusa2ParentDaily = numberFromSheet(sirusa2Parent[kolamHeaderIndex['DEMAND PER DAY (M3)']]);
if (sirusa2RawDaily !== 15301.38 || sirusa2ParentDaily !== 10456.57) throw new Error(`Unexpected SIRUSA 2 hierarchy totals: raw=${sirusa2RawDaily}, parent=${sirusa2ParentDaily}`);

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
