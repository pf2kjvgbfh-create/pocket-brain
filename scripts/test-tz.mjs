// Runs the unit tests under fixed time zones so parsing never depends on the laptop/phone zone.
// Windows-friendly: the env var is set per child process (no `TZ=… cmd` shell syntax needed).
import { spawnSync } from 'node:child_process';

const ZONES = ['UTC', 'America/New_York'];
const extraArgs = process.argv.slice(2);

for (const tz of ZONES) {
  console.log(`\n=== vitest run with TZ=${tz} ===`);
  const res = spawnSync('pnpm', ['exec', 'vitest', 'run', ...extraArgs], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, TZ: tz },
  });
  if (res.status !== 0) {
    console.error(`Tests failed with TZ=${tz}`);
    process.exit(res.status ?? 1);
  }
}
console.log(`\nAll tests passed in: ${ZONES.join(', ')}`);
