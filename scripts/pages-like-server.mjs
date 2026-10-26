// Serves dist/ under /pocket-brain/ like GitHub Pages does: every file gzip-compressed with the compressed
// Content-Length (also on HEAD). For the model cache check (src/model/cache-fix.ts):
//   node scripts/pages-like-server.mjs dist 4181
//   BASE_URL=http://localhost:4181/pocket-brain/ MODEL_E2E=1 pnpm exec playwright test e2e/model.spec.ts --project=chromium -g "real model"
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
const [dist, port] = [process.argv[2], Number(process.argv[3])];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const cache = new Map();
createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/pocket-brain/')) { res.writeHead(404).end(); return; }
  let p = join(dist, decodeURIComponent(url.pathname.slice('/pocket-brain/'.length)));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) { res.writeHead(404).end(); return; }
  let body = cache.get(p);
  if (!body) { body = gzipSync(readFileSync(p), { level: 1 }); cache.set(p, body); }
  res.writeHead(200, { 'Content-Type': types[extname(p)] ?? 'application/octet-stream', 'Content-Encoding': 'gzip', 'Content-Length': body.length, 'Cache-Control': 'max-age=600' });
  if (req.method === 'HEAD') res.end(); else res.end(body);
}).listen(port, () => console.log('gzip server on', port));
