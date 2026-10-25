// Stage-5 model evaluation runner (dev only). Serves the model shards locally, opens tools/model-eval/ in a
// Playwright browser through the Vite dev server, classifies the 50 fixture phrases + the «unsure» phrases with each
// candidate, and writes the raw results to OUT (JSON). Usage:
//   node tools/model-eval/run.mjs <shards-root> <out.json> [chromium|webkit] [candidate-id] [max-phrases]
import { spawn } from 'node:child_process';
import { createReadStream, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, normalize, resolve } from 'node:path';
import { chromium, webkit } from '@playwright/test';

const [shardsArg, outPath, browserName = 'chromium', only, maxPhrases, gpu = '0'] = process.argv.slice(2);
const gpuLayers = Number(gpu);
const shardsRoot = shardsArg && resolve(shardsArg);
if (!shardsRoot || !outPath) throw new Error('usage: run.mjs <shards-root> <out.json> [chromium|webkit] [candidate] [max]');

const CANDIDATES = [
  { id: 'q25', name: 'Qwen2.5-0.5B-Instruct Q4_K_M', dir: 'split-q25', first: 'qwen2.5-0.5b-instruct-q4_k_m-00001-of-00005.gguf', noThinking: false },
  { id: 'q3', name: 'Qwen3-0.6B Q4_K_M', dir: 'split-q3', first: 'qwen3-0.6b-q4_k_m-00001-of-00004.gguf', noThinking: true },
].filter((c) => !only || c.id === only);

const root = join(import.meta.dirname, '..', '..');
const fixture = JSON.parse(readFileSync(join(root, 'tests/fixtures/phrases.ru.json'), 'utf8'));
const unsure = JSON.parse(readFileSync(join(root, 'tests/fixtures/unsure.ru.json'), 'utf8'));
let phrases = [
  // The «unsure» phrases first: they are the ones the app will really send to the model.
  ...unsure.phrases.map((p) => ({ text: p.text, kind: p.kind, set: 'unsure' })),
  ...fixture.phrases.map((p) => ({ text: p.text, kind: p.expected.kind, set: 'fixture' })),
];
if (maxPhrases) phrases = phrases.slice(0, Number(maxPhrases));

// Static shard server with CORS (the page runs on another port).
const SHARD_PORT = 4181;
const shardServer = createServer((req, res) => {
  const rel = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '');
  const file = join(shardsRoot, rel);
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-length' };
  if (req.method === 'OPTIONS') return res.writeHead(204, headers).end();
  if (!file.startsWith(shardsRoot)) return res.writeHead(403, headers).end();
  let size;
  try {
    size = statSync(file).size;
  } catch {
    return res.writeHead(404, headers).end();
  }
  res.writeHead(200, { ...headers, 'content-type': 'application/octet-stream', 'content-length': size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
});
await new Promise((r) => shardServer.listen(SHARD_PORT, r));

const VITE_PORT = 5199;
const vite = spawn('pnpm', ['exec', 'vite', '--port', String(VITE_PORT), '--strictPort'], { cwd: root, shell: true, stdio: 'ignore' });
const pageUrl = `http://localhost:${VITE_PORT}/pocket-brain/tools/model-eval/index.html`;
for (let i = 0; ; i += 1) {
  try {
    if ((await fetch(pageUrl)).ok) break;
  } catch {
    // not up yet
  }
  if (i > 60) throw new Error('vite did not start');
  await new Promise((r) => setTimeout(r, 1000));
}

const engine = browserName === 'webkit' ? webkit : chromium;
const out = { browser: browserName, date: new Date().toISOString(), results: [] };
try {
  for (const c of CANDIDATES) {
    const browser = await engine.launch(browserName === 'chromium' && gpuLayers > 0 ? { args: ['--enable-unsafe-webgpu'] } : {});
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') console.log(`[${c.id}] console: ${m.text().slice(0, 200)}`);
    });
    await page.goto(pageUrl);
    await page.waitForSelector('body[data-ready="1"]');
    const shardUrls = [`http://localhost:${SHARD_PORT}/${c.dir}/${c.first}`];
    console.log(`[${c.id}] start ${phrases.length} phrases in ${browserName}, gpu layers ${gpuLayers}, webgpu in page: ${await page.evaluate(() => 'gpu' in navigator)}`);
    const t0 = Date.now();
    const loadSeconds = await page.evaluate(([u, g]) => window.loadOnly(u, g), [shardUrls, gpuLayers]);
    console.log(`[${c.id}] first load ${loadSeconds.toFixed(1)} s`);
    const result = { id: c.id, name: c.name, loadSeconds, cacheLoadSeconds: null, gpuLayers, rows: [] };
    out.results.push(result);
    for (const p of phrases) {
      let row;
      try {
        row = await page.evaluate(([t, n]) => window.classifyOne(t, n), [p.text, c.noThinking]);
      } catch (e) {
        row = { error: String(e).slice(0, 300) };
      }
      result.rows.push({ text: p.text, expected: p.kind, set: p.set, ...row });
      writeFileSync(outPath, JSON.stringify(out, null, 1));
      console.log(`[${c.id}] ${result.rows.length}/${phrases.length} ${p.text} -> ${row.kind ?? row.error} ${row.seconds?.toFixed(1)} s`);
    }
    console.log(`[${c.id}] eval done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    await page.reload();
    await page.waitForSelector('body[data-ready="1"]');
    const cacheLoadSeconds = await page.evaluate(([u, g]) => window.loadOnly(u, g), [shardUrls, gpuLayers]);
    console.log(`[${c.id}] load from cache ${cacheLoadSeconds.toFixed(1)} s`);
    result.cacheLoadSeconds = cacheLoadSeconds;
    writeFileSync(outPath, JSON.stringify(out, null, 1));
    await browser.close();
  }
} finally {
  shardServer.close();
  vite.kill();
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(vite.pid), '/T', '/F'], { stdio: 'ignore' });
}
console.log('written', outPath);
