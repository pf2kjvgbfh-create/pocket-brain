// Deploy: build, then force-push dist/ as a single-commit orphan branch `gh-pages` (see DECISIONS.md).
// One commit each time, so old builds (and old model shards) never pile up in the branch history.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// pnpm is a .cmd shim on Windows and needs a shell; git must not get one (it would split the commit message).
const run = (cmd, args, cwd = root) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: cmd === 'pnpm' && process.platform === 'win32' });
const read = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim();
const commit = (cwd, message) =>
  run('git', ['-c', 'user.name=pocket-brain-deploy', '-c', 'user.email=deploy@localhost', 'commit', '-q', '-m', message], cwd);

/** Files above this size are uploaded one per push (the model shards ~90 MB, the wllama wasm 9–16 MB). */
const BIG_FILE = 5 * 1024 * 1024;
const UPLOAD_BRANCH = 'deploy-upload';

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** Paths already on the live site (the fetched gh-pages); empty on the very first deploy. */
function publishedFiles(cwd) {
  try {
    const out = execFileSync('git', ['ls-tree', '-r', '--name-only', 'FETCH_HEAD'], { cwd, encoding: 'utf8' });
    return new Set(out.split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
}

if (!process.argv.includes('--no-build')) run('pnpm', ['build']);

// The model shards are not in git (357 MB; see DECISIONS.md) — they live in public/model/ on this laptop and on the
// site. A build without them would publish a site whose «Умный разбор» cannot load: stop instead.
const SHARDS = [1, 2, 3, 4].map((n) => `qwen3-0.6b-q4_k_m-0000${n}-of-00004.gguf`);
const missing = SHARDS.filter((f) => !existsSync(join(root, 'dist', 'model', f)));
if (missing.length > 0) {
  console.error(`model shards missing in dist/model/: ${missing.join(', ')} — rebuild them (DECISIONS.md, 2026-10-24) into public/model/`);
  process.exit(1);
}

const remote = read('git', ['remote', 'get-url', 'origin']);
const sha = read('git', ['rev-parse', '--short', 'HEAD']);
const tmp = mkdtempSync(join(tmpdir(), 'pocket-brain-pages-'));
try {
  cpSync(join(root, 'dist'), tmp, { recursive: true });
  writeFileSync(join(tmp, '.nojekyll'), '');
  run('git', ['init', '-q', '-b', 'gh-pages'], tmp);
  // Fetch the current site first: files that did not change (above all the model shards, ~360 MB) are then already
  // known to the remote and are not uploaded again. The new commit is still an orphan, so no history piles up.
  try {
    execFileSync('git', ['fetch', '-q', '--depth', '1', remote, 'gh-pages'], { cwd: tmp, stdio: 'inherit' });
  } catch {
    console.log('no gh-pages yet: full upload');
  }
  // One push of ~380 MB times out at GitHub (HTTP 408). So the big files go first, one per push, to a temporary
  // branch; the real orphan commit then only uploads what is left, and the temporary branch is deleted.
  const known = publishedFiles(tmp);
  const big = [...walk(tmp)].filter((f) => statSync(f).size > BIG_FILE && !known.has(relative(tmp, f).split(sep).join('/')));
  for (const file of big) {
    run('git', ['add', '--', file], tmp);
    commit(tmp, `upload ${relative(tmp, file)}`);
    run('git', ['-c', 'http.postBuffer=524288000', 'push', '--force', remote, `HEAD:refs/heads/${UPLOAD_BRANCH}`], tmp);
  }
  if (big.length > 0) run('git', ['update-ref', '-d', 'HEAD'], tmp); // the site commit stays an orphan
  run('git', ['add', '-A'], tmp);
  commit(tmp, `deploy ${sha}`);
  run('git', ['-c', 'http.postBuffer=524288000', 'push', '--force', remote, 'gh-pages'], tmp);
  // Always: a run that failed after an upload leaves the temporary branch behind. No branch = nothing to delete.
  try {
    execFileSync('git', ['push', '-q', remote, '--delete', UPLOAD_BRANCH], { cwd: tmp, stdio: 'ignore' });
  } catch {
    // not there
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log('deployed gh-pages from', sha);
