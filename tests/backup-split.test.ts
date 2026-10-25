import { describe, expect, it } from 'vitest';
import { BACKUP } from '../src/config';
import { buildBackup } from '../src/backup/serialize';
import { assembleBackup, fingerprint, monthOfUtc, monthPath, planFiles } from '../src/backup/split';
import type { RecordRow, WalletRow } from '../src/db/types';

const wallets: WalletRow[] = [{ id: 'cash', name: 'Наличные', hidden: false, start_balance_minor: 0 }];
const text = 'запись про деньги и дела '.repeat(8); // Cyrillic: 2 bytes per letter
function rec(i: number, month: string): RecordRow {
  return {
    id: `id-${i}`, kind: 'idea', raw_text: `${text}${i}`, fields: { title: `t${i}` }, wallet_id: null, due_utc: null,
    created_utc: `${month}-${String((i % 27) + 1).padStart(2, '0')}T08:00:00.000Z`, updated_utc: `${month}-28T08:00:00.000Z`, deleted: i % 7 === 0,
  };
}
const NOW = '2026-10-24T10:00:00.000Z';

describe('month helpers', () => {
  it('month is the UTC month of created_utc; path from the config pattern', () => {
    expect(monthOfUtc('2026-10-31T23:30:00.000Z')).toBe('2026-10');
    expect(monthOfUtc('2026-11-01T00:00:00.000Z')).toBe('2026-11');
    expect(monthPath('2026-10')).toBe('data/records-2026-10.json');
  });
});

describe('split at > 1 MB and restore from the split files', () => {
  const records = Array.from({ length: 2000 }, (_, i) => rec(i, ['2026-08', '2026-09', '2026-10'][i % 3]));
  const full = buildBackup({ records, wallets, settings: {} }, NOW);

  it('a small backup is one file with the records inside', () => {
    const small = buildBackup({ records: records.slice(0, 5), wallets, settings: {} }, NOW);
    expect(planFiles(small).map((f) => f.path)).toEqual([BACKUP.mainPath]);
  });

  it('the full JSON is above 1 MB, so it splits: main keeps wallets/settings and the months list', () => {
    expect(new TextEncoder().encode(JSON.stringify(full)).length).toBeGreaterThan(BACKUP.splitBytes);
    const files = planFiles(full);
    expect(files.map((f) => f.path)).toEqual([
      'data/records-2026-08.json', 'data/records-2026-09.json', 'data/records-2026-10.json', BACKUP.mainPath,
    ]);
    const main = files[files.length - 1].file as ReturnType<typeof buildBackup>;
    expect(main.months).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(main.records).toEqual([]);
    expect(main.wallets).toEqual(wallets);
    for (const f of files.slice(0, -1)) {
      expect(new TextEncoder().encode(JSON.stringify(f.file)).length).toBeLessThan(BACKUP.splitBytes);
    }
  });

  it('restoring from the split files gives the identical record set (soft-deleted rows included)', () => {
    const files = planFiles(full);
    const parsed = files.map((f) => JSON.parse(JSON.stringify(f.file)) as unknown);
    const main = parsed[parsed.length - 1] as ReturnType<typeof buildBackup>;
    const months = parsed.slice(0, -1) as { month: string; records: RecordRow[] }[];
    const back = assembleBackup(main, months);
    const byId = (a: RecordRow, b: RecordRow): number => (a.id < b.id ? -1 : 1);
    expect([...back.records].sort(byId)).toEqual([...full.records].sort(byId));
    expect(back.wallets).toEqual(wallets);
  });
});

describe('fingerprint (skip unchanged files)', () => {
  it('ignores exported_utc, changes when content changes', async () => {
    const a = buildBackup({ records: [rec(1, '2026-10')], wallets, settings: {} }, NOW);
    const b = buildBackup({ records: [rec(1, '2026-10')], wallets, settings: {} }, '2027-01-01T00:00:00.000Z');
    const c = buildBackup({ records: [{ ...rec(1, '2026-10'), raw_text: 'другое' }], wallets, settings: {} }, NOW);
    const [fa] = planFiles(a);
    const [fb] = planFiles(b);
    const [fc] = planFiles(c);
    expect(await fingerprint(fa.file)).toBe(await fingerprint(fb.file));
    expect(await fingerprint(fa.file)).not.toBe(await fingerprint(fc.file));
  });
});
