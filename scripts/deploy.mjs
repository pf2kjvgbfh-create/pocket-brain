// Deploy: build, then force-push dist/ as a single-commit orphan branch `gh-pages` (see DECISIONS.md).
// One commit each time, so old builds (and old model shards) never pile up in the branch history.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
const read = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim();

if (!process.argv.includes('--no-build')) run('pnpm', ['build']);

const remote = read('git', ['remote', 'get-url', 'origin']);
const sha = read('git', ['rev-parse', '--short', 'HEAD']);
const tmp = mkdtempSync(join(tmpdir(), 'pocket-brain-pages-'));
try {
  cpSync(join(root, 'dist'), tmp, { recursive: true });
  writeFileSync(join(tmp, '.nojekyll'), '');
  run('git', ['init', '-q', '-b', 'gh-pages'], tmp);
  run('git', ['add', '-A'], tmp);
  run('git', ['-c', 'user.name=pocket-brain-deploy', '-c', 'user.email=deploy@localhost', 'commit', '-q', '-m', `deploy ${sha}`], tmp);
  run('git', ['push', '--force', remote, 'gh-pages'], tmp);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log('deployed gh-pages from', sha);
