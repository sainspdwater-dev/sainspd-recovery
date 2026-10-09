import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncSheetData } from './sync-sheet-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.kml': 'application/vnd.google-earth.kml+xml; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
let syncInFlight = null;

http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
    if (pathname === '/__sync-sheet-data' && request.method === 'POST') {
      syncInFlight ||= syncSheetData({ outputRoot: root }).finally(() => { syncInFlight = null; });
      const payload = await syncInFlight;
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ success: true, syncedAt: payload.syncedAt, counts: { kolam: payload.kolam.rows.length, masterlist: payload.masterlist.rows.length } }));
      return;
    }
    let filePath = path.resolve(root, `.${pathname}`);
    if (!filePath.startsWith(root)) throw new Error('Invalid path');
    if ((await stat(filePath)).isDirectory()) filePath = path.join(filePath, 'index.html');
    const data = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(data);
  } catch (error) {
    const status = request.url?.startsWith('/__sync-sheet-data') ? 500 : 404;
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(status === 500 ? JSON.stringify({ success: false, error: error.message || 'Sync failed' }) : JSON.stringify({ success: false, error: 'Not found' }));
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Admin prototype: http://127.0.0.1:${port}/index_dashboard.html?preview=1`);
  console.log(`Guest prototype: http://127.0.0.1:${port}/index_dashboard.html?preview=1&level=guest`);
});
