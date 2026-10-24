// Post-build step: write dist/sw.js with the precache list of the built app shell.
// The shell = index.html + every asset it references. Test page and wasm files are NOT precached.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrecacheList, extractAssetPaths, renderSw, versionHash } from './sw-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const base = '/pocket-brain/';

const htmlPath = join(dist, 'index.html');
if (!existsSync(htmlPath)) throw new Error('dist/index.html not found: run vite build first');
const html = readFileSync(htmlPath, 'utf8');

const assets = extractAssetPaths(html, base);
const entries = [['index.html', readFileSync(htmlPath)]];
for (const rel of assets) {
  const file = join(dist, rel);
  if (!existsSync(file)) throw new Error(`referenced asset missing in dist: ${rel}`);
  entries.push([rel, readFileSync(file)]);
}

const version = versionHash(entries);
const precache = buildPrecacheList(assets, base);
const template = readFileSync(join(root, 'scripts', 'sw.template.js'), 'utf8');
writeFileSync(join(dist, 'sw.js'), renderSw(template, { version, precache, base }));
console.log(`sw.js written: version ${version}, ${precache.length} precached urls`);
