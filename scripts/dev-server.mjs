import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.kml': 'application/vnd.google-earth.kml+xml; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
    let filePath = path.resolve(root, `.${pathname}`);
    if (!filePath.startsWith(root)) throw new Error('Invalid path');
    if ((await stat(filePath)).isDirectory()) filePath = path.join(filePath, 'index.html');
    const data = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(data);
  } catch (_) { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Not found'); }
}).listen(port, '127.0.0.1', () => {
  console.log(`Admin prototype: http://127.0.0.1:${port}/index_dashboard.html?preview=1`);
  console.log(`Guest prototype: http://127.0.0.1:${port}/index_dashboard.html?preview=1&level=guest`);
});

