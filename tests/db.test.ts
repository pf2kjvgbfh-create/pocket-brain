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
  it('opens an empty database: 4 stores, version 1, default wallets with stable ids', async () => {
    const db = await PocketDb.open(freshName());
    expect(db.version).toBe(1);
    expect(db.storeNames.sort()).toEqual(['drafts', 'records', 'settings', 'wallets']);
    expect(await db.listRecords()).toEqual([]);
    expect(await db.listDrafts()).toEqual([]);
    const wallets = await db.listWallets();
    expect(wallets.map((w) => w.id).sort()).toEqual(['cash', 'deposit', 'gold', 'silver', 'tinkoff']);
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
    expect(await again.listWallets()).toHaveLength(5);
    again.close();
  });

  it('a later migration upgrades an existing database and keeps its data', async () => {
    const name = freshName();
    const db1 = await PocketDb.open(name);
    await db1.putRecord(record('keep-me'));
    db1.close();
    const v2 = [...MIGRATIONS, (db: IDBDatabase) => { db.createObjectStore('extra', { keyPath: 'id' }); }];
    const db2 = await PocketDb.open(name, indexedDB, v2);
    expect(db2.version).toBe(2);
    expect(db2.storeNames).toContain('extra');
    expect((await db2.getRecord('keep-me'))?.id).toBe('keep-me');
    expect(await db2.listWallets()).toHaveLength(5);
    db2.close();
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
    const wallets = base.map((w) => (w.id === 'gold' ? { ...w, name: 'Копилка', hidden: true } : w));
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
