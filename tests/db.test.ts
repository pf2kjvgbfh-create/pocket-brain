import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { PocketDb } from '../src/db/db';
import { MIGRATIONS } from '../src/db/idb';
import { checkWalletName, walletIdByName, walletRefs } from '../src/db/wallets';
import { parse } from '../src/parser/index';
import { DEFAULT_WALLETS } from '../src/config';
import type { RecordRow } from '../src/db/types';

let counter = 0;
const freshName = (): string => `test-db-${(counter += 1)}`;

function record(id: string, over: Partial<RecordRow> = {}): RecordRow {
  return {
    id, kind: 'idea', raw_text: 'текст', fields: {}, wallet_id: null, due_utc: null,
    created_utc: '2026-10-22T09:00:00.000Z', updated_utc: '2026-10-22T09:00:00.000Z', deleted: false, ...over,
  };
}

describe('migrations', () => {
  it('opens an empty database: 4 stores, version 2, default wallets with stable ids (no «Вклад» since stage 7)', async () => {
    const db = await PocketDb.open(freshName());
    expect(db.version).toBe(2);
    expect(db.storeNames.sort()).toEqual(['drafts', 'records', 'settings', 'wallets']);
    expect(await db.listRecords()).toEqual([]);
    expect(await db.listDrafts()).toEqual([]);
    const wallets = await db.listWallets();
    expect(wallets.map((w) => w.id).sort()).toEqual(['cash', 'gold', 'silver', 'tinkoff']);
    expect(wallets.find((w) => w.id === 'gold')).toEqual({ id: 'gold', name: 'Золотая карта', hidden: false, start_balance_minor: 0 });
    db.close();
  });

  it('reopening does not reseed or reset wallets', async () => {
    const name = freshName();
    const db = await PocketDb.open(name);
    await db.putWallet({ id: 'gold', name: 'Копилка', hidden: true, start_balance_minor: 777 });
    db.close();
    const again = await PocketDb.open(name);
    const gold = (await again.listWallets()).find((w) => w.id === 'gold');
    expect(gold).toEqual({ id: 'gold', name: 'Копилка', hidden: true, start_balance_minor: 777 });
    expect(await again.listWallets()).toHaveLength(4);
    again.close();
  });

  it('a later migration upgrades an existing database and keeps its data', async () => {
    const name = freshName();
    const db1 = await PocketDb.open(name);
    await db1.putRecord(record('keep-me'));
    db1.close();
    const v3 = [...MIGRATIONS, (db: IDBDatabase) => { db.createObjectStore('extra', { keyPath: 'id' }); }];
    const db2 = await PocketDb.open(name, indexedDB, v3);
    expect(db2.version).toBe(3);
    expect(db2.storeNames).toContain('extra');
    expect((await db2.getRecord('keep-me'))?.id).toBe('keep-me');
    expect(await db2.listWallets()).toHaveLength(4);
    db2.close();
  });

  it('review 8: a database left open in another tab does not block a later schema upgrade', async () => {
    const name = freshName();
    const other = await PocketDb.open(name); // "another tab", never closed by the test
    const v3 = [...MIGRATIONS, (db: IDBDatabase) => { db.createObjectStore('extra', { keyPath: 'id' }); }];
    const db2 = await PocketDb.open(name, indexedDB, v3);
    expect(db2.version).toBe(3);
    db2.close();
    other.close();
  });

  /** A stage-6 database (version 1) that still has the «Вклад» wallet. */
  async function stage6Db(over: { balance?: number; records?: RecordRow[]; last?: string } = {}): Promise<string> {
    const name = freshName();
    const v1 = await PocketDb.open(name, indexedDB, MIGRATIONS.slice(0, 1));
    await v1.putWallet({ id: 'deposit', name: 'Вклад', hidden: false, start_balance_minor: over.balance ?? 0 });
    for (const r of over.records ?? []) await v1.putRecord(r);
    if (over.last) await v1.setSetting('last_wallet_id', over.last);
    v1.close();
    return name;
  }

  it('v2 removes an unused «Вклад» wallet and resets a «last wallet» that pointed to it', async () => {
    const db = await PocketDb.open(await stage6Db({ last: 'deposit' }));
    expect((await db.listWallets()).map((w) => w.id).sort()).toEqual(['cash', 'gold', 'silver', 'tinkoff']);
    expect(await db.getSetting('last_wallet_id')).toBeUndefined();
    db.close();
  });

  it('v2 keeps «Вклад» when a record uses it (even a transfer target) or it has a start balance; another last wallet stays', async () => {
    const used = await PocketDb.open(await stage6Db({ records: [record('t', { kind: 'transfer', wallet_id: 'gold', fields: { to_wallet_id: 'deposit' } })], last: 'gold' }));
    expect((await used.listWallets()).some((w) => w.id === 'deposit')).toBe(true);
    expect(await used.getSetting('last_wallet_id')).toBe('gold');
    used.close();
    const funded = await PocketDb.open(await stage6Db({ balance: 100, last: 'deposit' }));
    expect((await funded.listWallets()).some((w) => w.id === 'deposit')).toBe(true);
    expect(await funded.getSetting('last_wallet_id')).toBeUndefined();
    funded.close();
  });

  it('v2: old deposits lose their wallet (they never moved money), so no balance changes; other kinds keep theirs', async () => {
    const db = await PocketDb.open(await stage6Db({
      records: [
        record('d1', { kind: 'deposit', wallet_id: 'cash', fields: { amount_minor: 5_000_000 } }),
        record('e1', { kind: 'expense', wallet_id: 'cash', fields: { amount_minor: 10_000 } }),
      ],
    }));
    const byId = Object.fromEntries((await db.listRecords()).map((r) => [r.id, r]));
    expect(byId.d1.wallet_id).toBeNull();
    expect(byId.d1.fields.amount_minor).toBe(5_000_000);
    expect(byId.e1.wallet_id).toBe('cash');
    db.close();
  });

  it('v2: a «Вклад» wallet used only by old deposits is removed (the deposits stay, without a wallet)', async () => {
    const db = await PocketDb.open(await stage6Db({ records: [record('d1', { kind: 'deposit', wallet_id: 'deposit', fields: { amount_minor: 100_000 } })] }));
    expect((await db.listWallets()).some((w) => w.id === 'deposit')).toBe(false);
    const [dep] = await db.listRecords();
    expect(dep).toMatchObject({ id: 'd1', kind: 'deposit', wallet_id: null });
    db.close();
  });

  it('a kept «Вклад» wallet and hidden wallets are not recognised in speech', () => {
    const rows = [
      ...DEFAULT_WALLETS.map((w) => ({ id: w.id, name: w.name, hidden: w.id === 'gold', start_balance_minor: 0 })),
      { id: 'deposit', name: 'Вклад', hidden: false, start_balance_minor: 0 },
    ];
    const names = walletRefs(rows).map((w) => w.name);
    expect(names).toEqual(['Наличные', 'Серебряная карта', 'Тинькофф']);
    expect(parse('купил кофе 200 рублей золотой картой', new Date('2026-10-22T09:00:00Z'), walletRefs(rows)).fields.wallet).toBeUndefined();
  });
});

describe('several records from one phrase', () => {
  it('saveManyFromDraft writes all records and drops the draft; softDeleteMany removes them all', async () => {
    const db = await PocketDb.open(freshName());
    await db.putDraft({ id: 'd1', text: 'кофе 300 и круассан 250', created_utc: '2026-10-22T09:00:00.000Z' });
    await db.saveManyFromDraft([record('d1', { kind: 'expense' }), record('d1-2', { kind: 'expense' })], 'd1');
    expect((await db.listRecords()).map((r) => r.id).sort()).toEqual(['d1', 'd1-2']);
    expect(await db.listDrafts()).toEqual([]);
    expect(await db.softDeleteMany(['d1', 'd1-2', 'missing'], '2026-10-22T09:01:00.000Z')).toBe(2);
    expect(await db.listRecords()).toEqual([]);
    db.close();
  });

  it('a wallet the phrase created is saved in the same call («перевёл 10к на сбер»)', async () => {
    const db = await PocketDb.open(freshName());
    await db.putDraft({ id: 'd1', text: 'перевёл 10к на сбер', created_utc: '2026-10-22T09:00:00.000Z' });
    const sber = { id: 'w-d1', name: 'Сбер', hidden: false, start_balance_minor: 0 };
    await db.saveManyFromDraft([record('d1', { kind: 'transfer' })], 'd1', [sber]);
    expect((await db.listWallets()).find((w) => w.id === 'w-d1')).toEqual(sber);
    expect(await db.listDrafts()).toEqual([]);
    db.close();
  });
});

describe('records', () => {
  it('upsert by id never duplicates', async () => {
    const db = await PocketDb.open(freshName());
    await db.putRecord(record('r1', { raw_text: 'первый' }));
    await db.putRecord(record('r1', { raw_text: 'первый', fields: { title: 'правка' } }));
    await db.putRecord(record('r1', { raw_text: 'первый', fields: { title: 'ещё правка' } }));
    const all = await db.listAllRecords();
    expect(all).toHaveLength(1);
    expect(all[0].fields.title).toBe('ещё правка');
    db.close();
  });

  it('soft delete keeps the row but hides it from the live list', async () => {
    const db = await PocketDb.open(freshName());
    await db.putRecord(record('r1'));
    await db.putRecord(record('r2'));
    expect(await db.softDelete('r1', '2026-10-23T00:00:00.000Z')).toBe(true);
    expect(await db.softDelete('nope', '2026-10-23T00:00:00.000Z')).toBe(false);
    expect((await db.listRecords()).map((r) => r.id)).toEqual(['r2']);
    const all = await db.listAllRecords();
    expect(all).toHaveLength(2);
    const gone = await db.getRecord('r1');
    expect(gone?.deleted).toBe(true);
    expect(gone?.updated_utc).toBe('2026-10-23T00:00:00.000Z');
    db.close();
  });

  it('saveFromDraft writes the record and removes the draft; saving twice stays one record', async () => {
    const db = await PocketDb.open(freshName());
    await db.putDraft({ id: 'd1', text: 'купил воду', created_utc: '2026-10-22T09:00:00.000Z' });
    await db.saveFromDraft(record('d1', { raw_text: 'купил воду' }), 'd1');
    await db.saveFromDraft(record('d1', { raw_text: 'купил воду', fields: { title: 'вода' } }), 'd1');
    expect(await db.getDraft('d1')).toBeUndefined();
    const all = await db.listAllRecords();
    expect(all).toHaveLength(1);
    expect(all[0].fields.title).toBe('вода');
    db.close();
  });

  it('findRecentByRawText finds a live record inside the window only', async () => {
    const db = await PocketDb.open(freshName());
    await db.putRecord(record('old', { raw_text: 'то же', created_utc: '2026-10-22T08:00:00.000Z' }));
    await db.putRecord(record('new', { raw_text: 'то же', created_utc: '2026-10-22T09:00:00.000Z' }));
    await db.putRecord(record('del', { raw_text: 'удалено', created_utc: '2026-10-22T09:00:00.000Z', deleted: true }));
    expect((await db.findRecentByRawText('то же', '2026-10-22T08:50:00.000Z'))?.id).toBe('new');
    expect(await db.findRecentByRawText('то же', '2026-10-22T09:30:00.000Z')).toBeUndefined();
    expect(await db.findRecentByRawText('удалено', '2026-10-22T08:50:00.000Z')).toBeUndefined();
    db.close();
  });
});

describe('drafts and settings', () => {
  it('drafts are found by text, newest first, and deleted by id', async () => {
    const db = await PocketDb.open(freshName());
    await db.putDraft({ id: 'a', text: 'раз', created_utc: '2026-10-22T09:00:00.000Z' });
    await db.putDraft({ id: 'b', text: 'два', created_utc: '2026-10-22T10:00:00.000Z' });
    expect((await db.listDrafts()).map((d) => d.id)).toEqual(['b', 'a']);
    expect((await db.findDraftByText('раз'))?.id).toBe('a');
    await db.deleteDraft('a');
    expect(await db.findDraftByText('раз')).toBeUndefined();
    db.close();
  });

  it('settings store key -> value', async () => {
    const db = await PocketDb.open(freshName());
    expect(await db.getSetting('x')).toBeUndefined();
    await db.setSetting('x', { a: 1 });
    await db.setSetting('x', { a: 2 });
    expect(await db.getSetting('x')).toEqual({ a: 2 });
    db.close();
  });
});

describe('wallet helpers', () => {
  const base = DEFAULT_WALLETS.map((w) => ({ id: w.id, name: w.name, hidden: false, start_balance_minor: 0 }));

  it('a renamed default wallet still matches its spoken aliases and its new name', () => {
    const wallets = base.map((w) => (w.id === 'gold' ? { ...w, name: 'Копилка' } : w));
    const refs = walletRefs(wallets);
    const r = parse('купил воду за пятьсот рублей золотая карта', new Date('2026-10-22T09:00:00Z'), refs);
    expect(r.fields.wallet).toBe('Копилка');
    expect(walletIdByName(wallets, r.fields.wallet)).toBe('gold');
    const r2 = parse('потратил 100 рублей копилка', new Date('2026-10-22T09:00:00Z'), refs);
    expect(r2.fields.wallet).toBe('Копилка');
  });

  it('a custom wallet is matched by its name', () => {
    const wallets = [...base, { id: 'u1', name: 'Копилка сына', hidden: false, start_balance_minor: 0 }];
    const r = parse('потратил 300 рублей копилка сына', new Date('2026-10-22T09:00:00Z'), walletRefs(wallets));
    expect(walletIdByName(wallets, r.fields.wallet)).toBe('u1');
  });

  it('names must be unique and not empty', () => {
    expect(checkWalletName(base, '  ')).toEqual({ ok: false, reason: 'Введи название' });
    expect(checkWalletName(base, ' наличные ').ok).toBe(false);
    expect(checkWalletName(base, 'Наличные', 'cash').ok).toBe(true);
    expect(checkWalletName(base, ' Новый ')).toEqual({ ok: true, name: 'Новый' });
  });
});
