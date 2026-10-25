import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createBackupController, LINKED_KEY } from '../src/backup/runner';
import { createSingleFlight } from '../src/backup/queue';
import { TOKEN_KEY } from '../src/backup/token';
import { BACKUP } from '../src/config';
import { PocketDb } from '../src/db/db';
import type { RecordRow } from '../src/db/types';
import { FAKE_TOKEN, FakeRepo } from './helpers/fake-repo';

describe('single flight with coalescing', () => {
  it('requests during a run cause exactly one follow-up run', async () => {
    let runs = 0;
    let active = 0;
    let maxActive = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const q = createSingleFlight(async () => {
      runs += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (runs === 1) await gate;
      active -= 1;
    });
    q.request();
    q.request();
    q.request();
    q.request();
    expect(runs).toBe(1);
    release();
    await q.idle();
    expect(runs).toBe(2);
    expect(maxActive).toBe(1);
  });

  it('a throwing run does not break the queue', async () => {
    let runs = 0;
    const q = createSingleFlight(async () => {
      runs += 1;
      throw new Error('boom');
    });
    q.request();
    await q.idle();
    q.request();
    await q.idle();
    expect(runs).toBe(2);
  });
});

let n = 0;
const rec = (id: string, over: Partial<RecordRow> = {}): RecordRow => ({
  id, kind: 'idea', raw_text: 'мысль ' + id, fields: {}, wallet_id: null, due_utc: null,
  created_utc: '2026-10-22T09:00:00.000Z', updated_utc: '2026-10-22T09:00:00.000Z', deleted: false, ...over,
});

async function setup(token: string | null = FAKE_TOKEN) {
  const db = await PocketDb.open(`queue-${(n += 1)}`);
  if (token) await db.setSetting(TOKEN_KEY, token);
  const repo = new FakeRepo(BACKUP.owner, BACKUP.repo);
  const ctl = createBackupController({ db, fetch: repo.fetch, now: () => new Date('2026-10-24T10:00:00.000Z'), sleep: async () => undefined });
  db.setOnChange(() => ctl.trigger());
  return { db, repo, ctl };
}
const mainFile = (repo: FakeRepo): { records: RecordRow[]; wallets: unknown[] } =>
  JSON.parse(repo.files.get(BACKUP.mainPath) ?? 'null') as { records: RecordRow[]; wallets: unknown[] };

describe('backup controller (fake GitHub)', () => {
  it('two quick saves: never more than one request in flight; the final state is in the repo', async () => {
    const { db, repo, ctl } = await setup();
    await db.putRecord(rec('a'));
    await db.putRecord(rec('b'));
    await ctl.idle();
    expect(repo.maxInflight).toBe(1);
    expect(mainFile(repo).records.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(ctl.getStatus().lastOkUtc).toBe('2026-10-24T10:00:00.000Z');
    expect(ctl.getStatus().error).toBeNull();
  });

  it('409 on the first PUT -> retried with a fresh sha -> success', async () => {
    const { db, repo, ctl } = await setup();
    repo.files.set(BACKUP.mainPath, '{}');
    await db.setSetting(LINKED_KEY, true); // a device that already made a copy before
    repo.failures.push({ method: 'PUT', status: 409 });
    await db.putRecord(rec('a'));
    await ctl.idle();
    expect(mainFile(repo).records).toHaveLength(1);
    expect(ctl.getStatus().error).toBeNull();
  });

  it('422 -> same', async () => {
    const { db, repo, ctl } = await setup();
    repo.failures.push({ method: 'PUT', status: 422 });
    await db.putRecord(rec('a'));
    await ctl.idle();
    expect(mainFile(repo).records).toHaveLength(1);
  });

  it('401 -> auth message, one attempt, the record is still saved locally', async () => {
    const { db, repo, ctl } = await setup('github_pat_WRONG_FAKE');
    await db.putRecord(rec('a'));
    await ctl.idle();
    expect(ctl.getStatus().error).toBe('токен не подходит или истёк');
    expect(repo.log).toHaveLength(1);
    expect((await db.listRecords()).map((r) => r.id)).toEqual(['a']);
  });

  it('offline -> «нет интернета», saving unaffected', async () => {
    const { db } = await setup();
    const offline = createBackupController({
      db,
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
      sleep: async () => undefined,
    });
    await db.putRecord(rec('a'));
    offline.trigger();
    await offline.idle();
    expect(offline.getStatus().error).toBe('нет интернета');
    expect((await db.listRecords()).length).toBe(1);
  });

  it('no token: no request, status explains', async () => {
    const { db, repo, ctl } = await setup(null);
    await db.putRecord(rec('a'));
    await ctl.idle();
    expect(repo.log).toHaveLength(0);
    expect(ctl.getStatus().error).toBe('токен не введён');
  });

  it('a hanging backup never delays or blocks the save', async () => {
    const { db } = await setup();
    const hang = createBackupController({ db, fetch: () => new Promise<Response>(() => undefined), sleep: async () => undefined });
    db.setOnChange(() => hang.trigger());
    const t0 = Date.now();
    await db.putRecord(rec('a'));
    expect(Date.now() - t0).toBeLessThan(500);
    expect((await db.listRecords()).length).toBe(1);
  });

  it('unchanged files are skipped on the next run', async () => {
    const { db, repo, ctl } = await setup();
    await db.putRecord(rec('a'));
    await ctl.idle();
    const before = repo.putCount();
    ctl.trigger();
    await ctl.idle();
    expect(repo.putCount()).toBe(before);
    await db.putRecord(rec('b'));
    await ctl.idle();
    expect(repo.putCount()).toBe(before + 1);
  });

  it('the token is never in the repo, the URL log or the stored hashes', async () => {
    const { db, repo, ctl } = await setup();
    await db.putRecord(rec('a'));
    await ctl.idle();
    for (const text of repo.files.values()) {
      expect(text).not.toContain(FAKE_TOKEN);
      expect(text).not.toContain('github_pat');
    }
    expect(JSON.stringify(repo.log)).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(await db.getSetting('backup_hashes'))).not.toContain(FAKE_TOKEN);
  });
});
