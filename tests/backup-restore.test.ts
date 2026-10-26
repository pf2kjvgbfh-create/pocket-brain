import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createBackupController } from '../src/backup/runner';
import { applyMerge, loadRemote, mergeBackup } from '../src/backup/restore';
import { createGithubClient } from '../src/backup/github';
import { buildExport } from '../src/backup/export';
import { TOKEN_KEY } from '../src/backup/token';
import { BACKUP } from '../src/config';
import { PocketDb } from '../src/db/db';
import type { RecordRow, WalletRow } from '../src/db/types';
import { FAKE_TOKEN, FakeRepo } from './helpers/fake-repo';

const rec = (id: string, updated: string, over: Partial<RecordRow> = {}): RecordRow => ({
  id, kind: 'idea', raw_text: 'текст ' + id, fields: {}, wallet_id: null, due_utc: null,
  created_utc: '2026-10-01T09:00:00.000Z', updated_utc: updated, deleted: false, ...over,
});
const w = (id: string, name: string, bal = 0): WalletRow => ({ id, name, hidden: false, start_balance_minor: bal });

describe('mergeBackup', () => {
  it('adds missing, newest updated_utc wins, ties and older remote keep local', () => {
    const local = [
      rec('a', '2026-10-02T00:00:00Z', { raw_text: 'local-a' }),
      rec('b', '2026-10-05T00:00:00Z', { raw_text: 'local-b' }),
      rec('t', '2026-10-03T00:00:00Z', { raw_text: 'local-t' }),
    ];
    const remote = [
      rec('a', '2026-10-03T00:00:00Z', { raw_text: 'remote-a' }), // newer -> wins
      rec('b', '2026-10-04T00:00:00Z', { raw_text: 'remote-b' }), // older -> local stays
      rec('t', '2026-10-03T00:00:00Z', { raw_text: 'remote-t' }), // tie -> local stays
      rec('c', '2026-10-01T00:00:00Z', { raw_text: 'remote-c' }), // new
    ];
    const m = mergeBackup({ records: local, wallets: [] }, { records: remote, wallets: [], settings: {} });
    expect(m.records.map((r) => [r.id, r.raw_text]).sort()).toEqual([['a', 'remote-a'], ['c', 'remote-c']]);
  });

  it('a newer remote soft-delete wins (deletion is restored too)', () => {
    const m = mergeBackup(
      { records: [rec('a', '2026-10-02T00:00:00Z')], wallets: [] },
      { records: [rec('a', '2026-10-09T00:00:00Z', { deleted: true })], wallets: [], settings: {} },
    );
    expect(m.records[0].deleted).toBe(true);
  });

  it('wallets are merged by id: missing ones added, the backup version wins for existing ones', () => {
    const m = mergeBackup(
      { records: [], wallets: [w('cash', 'Наличные'), w('mine', 'Мой')] },
      { records: [], wallets: [w('cash', 'Кошелёк', 12345), w('new', 'Новый')], settings: {} },
    );
    expect(m.wallets.map((x) => [x.id, x.name, x.start_balance_minor]).sort()).toEqual([
      ['cash', 'Кошелёк', 12345],
      ['new', 'Новый', 0],
    ]);
  });

  it('count = live records in the backup', () => {
    const m = mergeBackup({ records: [], wallets: [] }, { records: [rec('a', 'x'), rec('b', 'x', { deleted: true })], wallets: [], settings: {} });
    expect(m.liveCount).toBe(1);
  });
});

let n = 0;
describe('restore end to end against the fake repo', () => {
  it('back up on one db, restore into a fresh one (with a split backup)', async () => {
    const repo = new FakeRepo(BACKUP.owner, BACKUP.repo);
    const src = await PocketDb.open(`restore-${(n += 1)}`);
    await src.setSetting(TOKEN_KEY, FAKE_TOKEN);
    await src.putWallet(w('cash', 'Наличные', 5000));
    const rows = Array.from({ length: 30 }, (_, i) =>
      rec(`id-${i}`, '2026-10-20T00:00:00Z', { raw_text: 'длинный текст '.repeat(100), created_utc: `2026-0${(i % 3) + 7}-10T00:00:00Z` }),
    );
    for (const r of rows) await src.putRecord(r);
    const ctl = createBackupController({ db: src, fetch: repo.fetch, sleep: async () => undefined, splitBytes: 20_000 });
    ctl.trigger();
    await ctl.idle();
    expect([...repo.files.keys()].some((p) => p.startsWith('data/records-'))).toBe(true);

    const dst = await PocketDb.open(`restore-${(n += 1)}`);
    const client = createGithubClient({ token: FAKE_TOKEN, fetch: repo.fetch, sleep: async () => undefined });
    const remote = await loadRemote(client);
    expect(remote.records).toHaveLength(30);
    const merged = mergeBackup({ records: await dst.listAllRecords(), wallets: await dst.listWallets() }, remote);
    await applyMerge(dst, merged);
    const byId = (a: RecordRow, b: RecordRow): number => (a.id < b.id ? -1 : 1);
    expect((await dst.listAllRecords()).sort(byId)).toEqual([...rows].sort(byId));
    expect((await dst.listWallets()).find((x) => x.id === 'cash')?.start_balance_minor).toBe(5000);
  });

  it('stage 7 fields survive back up -> restore into a fresh db', async () => {
    const repo = new FakeRepo(BACKUP.owner, BACKUP.repo);
    const src = await PocketDb.open(`restore-${(n += 1)}`);
    await src.setSetting(TOKEN_KEY, FAKE_TOKEN);
    const rows: RecordRow[] = [
      rec('debt', '2026-10-20T00:00:00Z', { kind: 'repay', wallet_id: 'cash', fields: { who: 'Петя', amount_minor: 300000, direction: 'to_me' } }),
      rec('usd', '2026-10-20T00:00:00Z', { kind: 'expense', fields: { amount_minor: 1000, currency: 'EUR', happened_utc: '2026-10-19T09:00:00.000Z' } }),
      rec('todo', '2026-10-20T00:00:00Z', { kind: 'reminder', fields: { title: 'x', no_time: true, done_utc: '2026-10-20T10:00:00.000Z' } }),
    ];
    for (const r of rows) await src.putRecord(r);
    const ctl = createBackupController({ db: src, fetch: repo.fetch, sleep: async () => undefined });
    ctl.trigger();
    await ctl.idle();
    const dst = await PocketDb.open(`restore-${(n += 1)}`);
    const client = createGithubClient({ token: FAKE_TOKEN, fetch: repo.fetch, sleep: async () => undefined });
    await applyMerge(dst, mergeBackup({ records: [], wallets: [] }, await loadRemote(client)));
    const byId = (a: RecordRow, b: RecordRow): number => (a.id < b.id ? -1 : 1);
    expect((await dst.listAllRecords()).sort(byId)).toEqual([...rows].sort(byId));
  });

  it('loadRemote on an empty repo says there is no copy', async () => {
    const repo = new FakeRepo(BACKUP.owner, BACKUP.repo);
    const client = createGithubClient({ token: FAKE_TOKEN, fetch: repo.fetch, sleep: async () => undefined });
    await expect(loadRemote(client)).rejects.toThrow(/нет/);
  });
});

describe('a new device never overwrites an existing copy', () => {
  it('empty phone + a copy in GitHub: no PUT until restore; after restore the backup proceeds and keeps the old records', async () => {
    const repo = new FakeRepo(BACKUP.owner, BACKUP.repo);
    const old = [rec('old-1', '2026-10-20T00:00:00Z'), rec('old-2', '2026-10-20T00:00:00Z')];
    repo.files.set(BACKUP.mainPath, JSON.stringify({ format: 'pocket-brain', version: 1, exported_utc: '', wallets: [], settings: {}, records: old }));
    const db = await PocketDb.open(`fresh-${(n += 1)}`);
    await db.setSetting(TOKEN_KEY, FAKE_TOKEN);
    const ctl = createBackupController({ db, fetch: repo.fetch, sleep: async () => undefined });
    db.setOnChange(() => ctl.trigger());
    await db.putRecord(rec('new-1', '2026-10-24T00:00:00Z'));
    await ctl.idle();
    expect(repo.putCount()).toBe(0);
    expect(ctl.getStatus().error).toContain('Восстановить из GitHub');
    expect((JSON.parse(repo.files.get(BACKUP.mainPath) ?? '') as { records: unknown[] }).records).toHaveLength(2);

    const client = createGithubClient({ token: FAKE_TOKEN, fetch: repo.fetch, sleep: async () => undefined });
    const remote = await loadRemote(client);
    await applyMerge(db, mergeBackup({ records: await db.listAllRecords(), wallets: await db.listWallets() }, remote));
    await ctl.idle();
    const after = (JSON.parse(repo.files.get(BACKUP.mainPath) ?? '') as { records: { id: string }[] }).records.map((r) => r.id).sort();
    expect(after).toEqual(['new-1', 'old-1', 'old-2']);
    expect(ctl.getStatus().error).toBeNull();
  });
});

describe('export', () => {
  it('has the same allowlisted JSON and no token', async () => {
    const db = await PocketDb.open(`export-${(n += 1)}`);
    await db.setSetting(TOKEN_KEY, FAKE_TOKEN);
    await db.putRecord(rec('a', '2026-10-02T00:00:00Z'));
    const e = await buildExport(db, new Date('2026-10-24T10:00:00Z'));
    expect(e.filename).toBe('pocket-brain-export-2026-10-24.json');
    expect(e.text).not.toContain(FAKE_TOKEN);
    expect(e.text).not.toContain('github_pat');
    const parsed = JSON.parse(e.text) as { format: string; records: unknown[]; months?: unknown };
    expect(parsed.format).toBe('pocket-brain');
    expect(parsed.records).toHaveLength(1);
    expect(parsed.months).toBeUndefined();
  });
});

describe('stage 2b: settings travel with the copy', () => {
  const learned = { 'кофе|idea': { to_kind: 'expense', wallet_id: 'gold', updated_utc: '2026-10-22T09:00:00.000Z' } };

  it('last wallet and corrections memory come back after a restore; the token does not travel', async () => {
    const repo = new FakeRepo(BACKUP.owner, BACKUP.repo);
    const src = await PocketDb.open(`settings-${(n += 1)}`);
    await src.setSetting(TOKEN_KEY, FAKE_TOKEN);
    await src.setSetting('last_wallet_id', 'gold');
    await src.setSetting('learned', learned);
    await src.putRecord(rec('a', '2026-10-20T00:00:00Z', { refine: 'pending' }));
    const ctl = createBackupController({ db: src, fetch: repo.fetch, sleep: async () => undefined });
    ctl.trigger();
    await ctl.idle();
    expect(repo.files.get(BACKUP.mainPath)).not.toContain(FAKE_TOKEN);

    const dst = await PocketDb.open(`settings-${(n += 1)}`);
    const client = createGithubClient({ token: FAKE_TOKEN, fetch: repo.fetch, sleep: async () => undefined });
    const remote = await loadRemote(client);
    await applyMerge(dst, mergeBackup({ records: [], wallets: [] }, remote));
    expect(await dst.getSetting('last_wallet_id')).toBe('gold');
    expect(await dst.getSetting('learned')).toEqual(learned);
    expect(await dst.getSetting(TOKEN_KEY)).toBeUndefined();
    expect((await dst.listAllRecords())[0].refine).toBe('pending');
  });

  it('a malformed value is not applied and does not break the restore', async () => {
    const dst = await PocketDb.open(`settings-${(n += 1)}`);
    await dst.setSetting('last_wallet_id', 'cash');
    const merged = mergeBackup({ records: [], wallets: [] }, { records: [rec('a', 'x')], wallets: [], settings: { last_wallet_id: 7, learned: 'junk' } });
    await applyMerge(dst, merged);
    expect(await dst.getSetting('last_wallet_id')).toBe('cash');
    expect(await dst.getSetting('learned')).toBeUndefined();
    expect(await dst.listAllRecords()).toHaveLength(1);
  });

  it('corrections memory is merged by entry: the newest entry wins, local-only entries stay', async () => {
    const dst = await PocketDb.open(`settings-${(n += 1)}`);
    await dst.setSetting('learned', {
      'кофе|idea': { to_kind: 'income', updated_utc: '2026-10-25T00:00:00.000Z' },
      'чай|idea': { to_kind: 'expense', updated_utc: '2026-10-01T00:00:00.000Z' },
    });
    const remote = {
      'кофе|idea': { to_kind: 'expense', updated_utc: '2026-10-22T09:00:00.000Z' }, // older: local stays
      'чай|idea': { to_kind: 'income', updated_utc: '2026-10-10T00:00:00.000Z' }, // newer: remote wins
      'сок|idea': { to_kind: 'expense', updated_utc: '2026-10-10T00:00:00.000Z' }, // new
    };
    await applyMerge(dst, mergeBackup({ records: [], wallets: [] }, { records: [], wallets: [], settings: { learned: remote } }));
    expect(await dst.getSetting('learned')).toEqual({
      'кофе|idea': { to_kind: 'income', updated_utc: '2026-10-25T00:00:00.000Z' },
      'чай|idea': { to_kind: 'income', updated_utc: '2026-10-10T00:00:00.000Z' },
      'сок|idea': { to_kind: 'expense', updated_utc: '2026-10-10T00:00:00.000Z' },
    });
  });
});

describe('review 1: a version-1 copy (before the deposit change) is brought up to date on restore', () => {
  const deposit = rec('dep', '2026-10-20T00:00:00Z', { kind: 'deposit', wallet_id: 'silver', fields: { amount_minor: 5000000 } });
  const oldFile = (over: Record<string, unknown> = {}): string =>
    JSON.stringify({
      format: 'pocket-brain', version: 1, exported_utc: '', settings: { last_wallet_id: 'deposit' },
      wallets: [w('cash', 'Наличные'), w('silver', 'Серебряная карта'), w('deposit', 'Вклад')],
      records: [deposit, rec('e1', '2026-10-20T00:00:00Z', { kind: 'expense', wallet_id: 'cash', fields: { amount_minor: 100 } })],
      ...over,
    });
  const clientFor = (repo: FakeRepo) => createGithubClient({ token: FAKE_TOKEN, fetch: repo.fetch, sleep: async () => undefined });

  it('deposits lose their wallet, the unused «Вклад» wallet and a last wallet pointing to it go; a new device ends up clean', async () => {
    const repo = new FakeRepo(BACKUP.owner, BACKUP.repo);
    repo.files.set(BACKUP.mainPath, oldFile());
    const remote = await loadRemote(clientFor(repo));
    expect(remote.records.find((r) => r.id === 'dep')?.wallet_id).toBeNull();
    expect(remote.wallets.map((x) => x.id)).not.toContain('deposit');
    expect(remote.settings).not.toHaveProperty('last_wallet_id');

    const db = await PocketDb.open(`v1-${(n += 1)}`);
    await applyMerge(db, mergeBackup({ records: await db.listAllRecords(), wallets: await db.listWallets() }, remote));
    expect((await db.listWallets()).map((x) => x.id)).not.toContain('deposit');
    expect(await db.getSetting('last_wallet_id')).toBeUndefined();
    expect((await db.getRecord('dep'))?.wallet_id).toBeNull();
  });

  it('the «Вклад» wallet stays when a record still uses it or it holds money', async () => {
    const repo = new FakeRepo(BACKUP.owner, BACKUP.repo);
    const used = rec('u', '2026-10-20T00:00:00Z', { kind: 'expense', wallet_id: 'deposit' });
    repo.files.set(BACKUP.mainPath, oldFile({ records: [used] }));
    expect((await loadRemote(clientFor(repo))).wallets.map((x) => x.id)).toContain('deposit');
    repo.files.set(BACKUP.mainPath, oldFile({ wallets: [w('deposit', 'Вклад', 700)] }));
    expect((await loadRemote(clientFor(repo))).wallets.map((x) => x.id)).toContain('deposit');
  });

  it('a split v1 copy (month files) is upgraded too', async () => {
    const repo = new FakeRepo(BACKUP.owner, BACKUP.repo);
    repo.files.set(BACKUP.mainPath, oldFile({ records: [], months: ['2026-10'] }));
    repo.files.set(`data/records-2026-10.json`, JSON.stringify({ format: 'pocket-brain', version: 1, month: '2026-10', records: [deposit] }));
    const remote = await loadRemote(clientFor(repo));
    expect(remote.records[0].wallet_id).toBeNull();
    expect(remote.wallets.map((x) => x.id)).not.toContain('deposit');
  });

  it('a current (version 2) copy keeps the wallet of a deposit and everything else', async () => {
    const repo = new FakeRepo(BACKUP.owner, BACKUP.repo);
    repo.files.set(BACKUP.mainPath, oldFile({ version: 2, settings: { last_wallet_id: 'silver' } }));
    const remote = await loadRemote(clientFor(repo));
    expect(remote.records.find((r) => r.id === 'dep')?.wallet_id).toBe('silver');
    expect(remote.settings).toHaveProperty('last_wallet_id', 'silver');
  });
});
