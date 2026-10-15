import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

const basePath = argument('--base');
const outputPath = argument('--output');
if (!basePath || !outputPath) {
  throw new Error('Usage: node scripts/build-integrated-worker.mjs --base <worker.js> --output <worker.js>');
}

const [baseSource, featureSource] = await Promise.all([
  readFile(path.resolve(basePath), 'utf8'),
  readFile(path.resolve('cloudflare-worker-kolam-snippet.js'), 'utf8')
]);

const unknownAction = '    return createResponse({ success: false, error: "Tindakan tidak dikenali." }, 400, corsHeaders);';
if (!baseSource.includes(unknownAction)) throw new Error('Worker router insertion point was not found.');
if ((baseSource.match(new RegExp(unknownAction.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length !== 1) {
  throw new Error('Worker router insertion point is ambiguous.');
}

const featureRouter = `    // Demand Bekalan Air: read actions
    if (reqData.action === "getReservoirData") {
      try { return createResponse(await getReservoirData(reqData, env), 200, corsHeaders); }
      catch (error) { return createResponse({ success: false, error: error.message }, 500, corsHeaders); }
    }
    if (reqData.action === "getSheetTable") {
      try { return createResponse(await getSheetTable(reqData, env), 200, corsHeaders); }
      catch (error) { return createResponse({ success: false, error: error.message }, 500, corsHeaders); }
    }
    if (reqData.action === "getReservoirKmlOverrides") {
      try { return createResponse(await getReservoirKmlOverrides(env), 200, corsHeaders); }
      catch (error) { return createResponse({ success: false, error: error.message }, 500, corsHeaders); }
    }

    // Demand Bekalan Air: admin-only write actions
    const sheetWriteActions = new Set(["updateSheetCells", "deleteSheetRow", "deleteSheetRows", "uploadReservoirImage", "saveReservoirKml"]);
    if (sheetWriteActions.has(reqData.action)) {
      if (!(await verifySession(request, env))) {
        return createResponse({ success: false, error: "Unauthorized: Sila log masuk semula." }, 401, corsHeaders);
      }
      if (!(await checkRateLimit(request, env, "sheet-write", 30, 60))) {
        return createResponse({ success: false, error: "Terlalu banyak permintaan kemas kini. Sila cuba sebentar lagi." }, 429, corsHeaders);
      }
      try {
        let result;
        if (reqData.action === "updateSheetCells") result = await updateSheetCells(reqData, env);
        else if (reqData.action === "deleteSheetRow") result = await deleteSheetRow(reqData, env);
        else if (reqData.action === "deleteSheetRows") result = await deleteSheetRows(reqData, env);
        else if (reqData.action === "uploadReservoirImage") result = await uploadReservoirImage(reqData, env);
        else result = await saveReservoirKml(reqData, env);
        return createResponse(result, 200, corsHeaders);
      } catch (error) {
        return createResponse({ success: false, error: error.message }, 400, corsHeaders);
      }
    }

${unknownAction}`;

const integrated = `${baseSource.replace(unknownAction, featureRouter).trimEnd()}\n\n${featureSource.trim()}\n`;
new Function(integrated.replace(/export\s+default/, 'return'));
await writeFile(path.resolve(outputPath), integrated, 'utf8');
console.log(`Integrated Worker written to ${path.resolve(outputPath)}`);

