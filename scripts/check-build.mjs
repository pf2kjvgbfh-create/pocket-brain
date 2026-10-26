// After `pnpm build`: the shipped files (dist/, except dist/test/ and .wasm) must not contain a token
// and must not talk to any host except api.github.com. Fails (exit 1) on a hit.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DIST = new URL('../dist', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Hosts that may appear as URLs in the shipped files, and why:
const ALLOWED_HOSTS = new Map([
  ['api.github.com', 'the backup endpoint (the only network host the app uses)'],
  ['www.w3.org', 'XML namespace strings (e.g. http://www.w3.org/2000/svg); never fetched'],
]);

// Exact URLs (not whole hosts) that may appear: a plain link the owner taps, the app never sends anything there.
// Only this prefix followed by `?` or the end of the URL passes; any other github.com address still fails.
const ALLOWED_URL_PREFIXES = [
  ['https://github.com/settings/personal-access-tokens/new', 'Settings → «Ключ доступа»: GitHub page for a new key (DECISIONS stage 7)'],
];
const isAllowedUrl = (url) => ALLOWED_URL_PREFIXES.some(([p]) => url === p || url.startsWith(`${p}?`));

// Hosts that appear only inside the wllama library chunk (stage 5) and are never contacted; e2e/model.spec.ts checks
// at runtime that loading and running the model requests nothing outside our own site.
const WLLAMA_HOSTS = new Map([
  ['cdn.jsdelivr.net', 'wllama default compat files; replaced by our own copies through setCompat() in src/model/engine.ts'],
  ['huggingface.co', 'wllama loadModelFromHF(), which the app never calls (shards come from our own site)'],
  ['github.com', 'source comments inside the embedded worker code'],
]);
const isWllamaChunk = (text) => text.includes('@wllama/wllama-compat');

const SECRET_PATTERNS = [/github_pat/, /ghp_[A-Za-z0-9]/, /gho_[A-Za-z0-9]/, /ghs_[A-Za-z0-9]/, /ghu_[A-Za-z0-9]/];
const TEXT_EXT = new Set(['.js', '.mjs', '.html', '.css', '.json', '.svg', '.webmanifest', '.txt', '.map']);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

// Which files belong to the app? Everything outside assets/ and test/, plus every assets/ file that those mention
// (directly or through other assets), so the iPhone test page's own chunks are not scanned.
const all = [...walk(DIST)].map((f) => ({ file: f, rel: relative(DIST, f).split(sep).join('/') }));
const isText = (rel) => TEXT_EXT.has(rel.slice(rel.lastIndexOf('.')));
const assets = all.filter((f) => f.rel.startsWith('assets/'));
const reach = new Set(all.filter((f) => !f.rel.startsWith('assets/') && !f.rel.startsWith('test/')).map((f) => f.rel));
const queue = [...reach];
while (queue.length > 0) {
  const rel = queue.pop();
  if (!isText(rel)) continue;
  const text = readFileSync(join(DIST, rel), 'utf8');
  for (const a of assets) {
    if (!reach.has(a.rel) && text.includes(a.rel.slice('assets/'.length))) {
      reach.add(a.rel);
      queue.push(a.rel);
    }
  }
}

const problems = [];
const seenHosts = new Map();
const allowedUrls = new Map();
let scanned = 0;

for (const rel of [...reach].sort()) {
  if (!isText(rel)) continue; // .wasm and other binaries
  scanned += 1;
  const text = readFileSync(join(DIST, rel), 'utf8');
  for (const re of SECRET_PATTERNS) {
    if (re.test(text)) problems.push(`${rel}: matches secret pattern ${re}`);
  }
  for (const m of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)[^\s"'`\\<>)]*/g)) {
    if (isAllowedUrl(m[0])) {
      allowedUrls.set(m[0], (allowedUrls.get(m[0]) ?? new Set()).add(rel));
      continue;
    }
    const host = m[1].toLowerCase();
    seenHosts.set(host, (seenHosts.get(host) ?? new Set()).add(rel));
    if (!ALLOWED_HOSTS.has(host) && !(WLLAMA_HOSTS.has(host) && isWllamaChunk(text))) problems.push(`${rel}: external host ${host}`);
  }
}

console.log(`check:build scanned ${scanned} text files reachable from the app (skipped dist/test/, the test page's chunks and .wasm)`);
for (const [url, files] of allowedUrls) console.log(`  link ${url}: allowed exact link (${[...files].join(', ')})`);
for (const [host, files] of seenHosts) {
  const status = ALLOWED_HOSTS.has(host) ? 'allowed' : WLLAMA_HOSTS.has(host) ? 'wllama chunk only' : 'NOT ALLOWED';
  console.log(`  host ${host}: ${status} (${[...files].join(', ')})`);
}
if (problems.length > 0) {
  for (const p of problems) console.error(`FAIL ${p}`);
  process.exit(1);
}
console.log('check:build OK: no token pattern, no external host except the allowed ones');
