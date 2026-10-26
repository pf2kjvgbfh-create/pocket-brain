import { describe, expect, it } from 'vitest';
import { buildBackup, parseBackup, serializeRecord } from '../src/backup/serialize';
import { planFiles } from '../src/backup/split';
import type { RecordRow, WalletRow } from '../src/db/types';
import { FAKE_TOKEN } from './helpers/fake-repo';

const rec = (id: string, over: Partial<RecordRow> = {}): RecordRow => ({
  id, kind: 'expense', raw_text: 'купил воду за пятьсот рублей', fields: { amount_minor: 50000, title: 'вода' },
  wallet_id: 'gold', due_utc: null, created_utc: '2026-10-22T09:00:00.000Z', updated_utc: '2026-10-22T09:00:00.000Z', deleted: false, ...over,
});
const wallets: WalletRow[] = [{ id: 'gold', name: 'Золотая карта', hidden: false, start_balance_minor: 100000 }];
const NOW = '2026-10-24T10:00:00.000Z';

describe('allowlist serializer', () => {
  it('output has the documented shape', () => {
    const f = buildBackup({ records: [rec('a')], wallets, settings: {} }, NOW);
    expect(Object.keys(f)).toEqual(['format', 'version', 'exported_utc', 'wallets', 'settings', 'records']);
    expect(f.format).toBe('pocket-brain');
    expect(f.version).toBe(2);
    expect(f.exported_utc).toBe(NOW);
  });

  it('drops unknown fields of records, fields and wallets', () => {
    const dirty = { ...rec('a'), secret: 'x', fields: { title: 't', evil: 'y' } } as unknown as RecordRow;
    const dirtyWallet = { ...wallets[0], token: FAKE_TOKEN } as unknown as WalletRow;
    const f = buildBackup({ records: [dirty], wallets: [dirtyWallet], settings: {} }, NOW);
    expect(JSON.stringify(f)).not.toContain('secret');
    expect(JSON.stringify(f)).not.toContain('evil');
    expect(JSON.stringify(f)).not.toContain(FAKE_TOKEN);
    expect(f.wallets[0]).toEqual(wallets[0]);
    expect(serializeRecord(dirty).fields).toEqual({ title: 't' });
  });

  it('settings: only allowlisted keys; the token key is refused even if someone allowlists it', () => {
    const settings = { github_token: FAKE_TOKEN, backup_hashes: { a: 'b' }, theme: 'dark' };
    const f = buildBackup({ records: [], wallets: [], settings }, NOW, ['theme']);
    expect(f.settings).toEqual({ theme: 'dark' });
    const g = buildBackup({ records: [], wallets: [], settings }, NOW, ['theme', 'github_token']);
    expect(g.settings).toEqual({ theme: 'dark' });
  });

  it('the fake token is absent from the main file, every month file and the export', () => {
    const settings = { github_token: FAKE_TOKEN, theme: 'dark' };
    const many = Array.from({ length: 40 }, (_, i) =>
      rec(`id-${i}`, { created_utc: `2026-${i % 2 ? '09' : '10'}-15T09:00:00.000Z`, raw_text: 'длинная запись '.repeat(50) }),
    );
    const full = buildBackup({ records: many, wallets, settings }, NOW, ['theme']);
    const split = planFiles(full, 5_000); // forces month files
    expect(split.length).toBeGreaterThan(1);
    const outputs = [JSON.stringify(full), ...split.map((p) => JSON.stringify(p.file))];
    for (const out of outputs) {
      expect(out).not.toContain(FAKE_TOKEN);
      expect(out).not.toContain('github_pat');
      expect(out).not.toContain('github_token');
    }
  });

  it('parseBackup validates format and drops malformed records', () => {
    const good = JSON.stringify(buildBackup({ records: [rec('a')], wallets, settings: {} }, NOW));
    expect(parseBackup(good).records).toHaveLength(1);
    expect(() => parseBackup('not json')).toThrow();
    expect(() => parseBackup(JSON.stringify({ format: 'other', version: 1 }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ format: 'pocket-brain', version: 99, records: [], wallets: [] }))).toThrow();
    const withJunk = JSON.stringify({
      format: 'pocket-brain', version: 1, exported_utc: NOW, wallets: [{ id: 5 }, wallets[0]], settings: {},
      records: [rec('ok'), { id: 7 }, null, { ...rec('bad-kind'), kind: 'nope' }],
    });
    const parsed = parseBackup(withJunk);
    expect(parsed.records.map((r) => r.id)).toEqual(['ok']);
    expect(parsed.wallets.map((w) => w.id)).toEqual(['gold']);
  });

  it('parseBackup drops field values of the wrong type (a bad copy must not break the lists or the totals)', () => {
    const bad = {
      ...rec('typed'),
      fields: {
        title: 5, amount_minor: '5', to_wallet_id: {}, who: ['x'], rate: 'NaN', term_months: null, day: Infinity,
        tags: { length: 1 },
      },
    };
    const mixed = { ...rec('mixed'), fields: { title: 'вода', amount_minor: 50000.4, tags: ['дом', 7, 'вода'] } };
    const text = JSON.stringify({ format: 'pocket-brain', version: 1, exported_utc: NOW, wallets: [], settings: {}, records: [bad, mixed] });
    const [typed, ok] = parseBackup(text).records;
    expect(typed.fields).toEqual({});
    expect(ok.fields).toEqual({ title: 'вода', amount_minor: 50000, tags: ['дом', 'вода'] });
  });
});

describe('stage 2b: refine flag and the settings that travel with the copy', () => {
  const learned = { 'кофе|idea': { to_kind: 'expense', wallet_id: 'gold', updated_utc: '2026-10-22T09:00:00.000Z' } };

  it('refine survives only as «pending»', () => {
    expect(serializeRecord(rec('a', { refine: 'pending' })).refine).toBe('pending');
    expect('refine' in serializeRecord(rec('a'))).toBe(false);
    expect('refine' in serializeRecord({ ...rec('a'), refine: 'done' } as unknown as RecordRow)).toBe(false);
    const text = JSON.stringify({
      format: 'pocket-brain', version: 1, exported_utc: NOW, wallets: [], settings: {},
      records: [{ ...rec('a'), refine: 'pending' }, { ...rec('b'), refine: 'whatever' }],
    });
    const back = parseBackup(text).records;
    expect(back.find((r) => r.id === 'a')?.refine).toBe('pending');
    expect(back.find((r) => r.id === 'b')?.refine).toBeUndefined();
  });

  it('last_wallet_id and learned are allowlisted and round-trip; the token still never goes', () => {
    const settings = { last_wallet_id: 'gold', learned, github_token: FAKE_TOKEN, backup_hashes: { a: 'b' } };
    const f = buildBackup({ records: [rec('a')], wallets, settings }, NOW);
    expect(f.settings).toEqual({ last_wallet_id: 'gold', learned });
    expect(JSON.stringify(f)).not.toContain(FAKE_TOKEN);
    expect(parseBackup(JSON.stringify(f)).settings).toEqual({ last_wallet_id: 'gold', learned });
  });

  it('malformed settings from outside are dropped', () => {
    const text = (settings: unknown): string =>
      JSON.stringify({ format: 'pocket-brain', version: 1, exported_utc: NOW, wallets: [], settings, records: [] });
    expect(parseBackup(text({ last_wallet_id: 5, learned: 'x' })).settings).toEqual({});
    expect(parseBackup(text({ learned: [1, 2] })).settings).toEqual({});
    expect(parseBackup(text({ learned: { 'a|idea': 'oops', 'b|idea': { to_kind: 'expense', updated_utc: 3 } } })).settings).toEqual({ learned: {} });
    expect(parseBackup(text({ learned: { 'a|idea': { to_kind: 'bogus', wallet_id: 'gold', updated_utc: 'x', evil: 1 } } })).settings).toEqual({
      learned: { 'a|idea': { wallet_id: 'gold', updated_utc: 'x' } },
    });
    expect(parseBackup(text({ github_token: FAKE_TOKEN })).settings).toEqual({});
  });
});

describe('stage 7: new fields travel with the copy', () => {
  const debt = rec('d', {
    kind: 'debt', wallet_id: null, raw_text: 'Маша должна мне 1500',
    fields: { who: 'Маша', amount_minor: 150000, direction: 'to_me' },
  });
  const usd = rec('u', { fields: { title: 'кофе', amount_minor: 1000, currency: 'USD', happened_utc: '2026-10-21T09:00:00.000Z' } });
  const todo = rec('t', {
    kind: 'reminder', wallet_id: null, due_utc: '2026-10-23T09:00:00.000Z',
    fields: { title: 'позвонить', no_time: true, done_utc: '2026-10-23T10:00:00.000Z' },
  });

  it('serialize -> parse keeps direction, currency, happened_utc, no_time and done_utc', () => {
    const f = buildBackup({ records: [debt, usd, todo], wallets, settings: {} }, NOW);
    expect(parseBackup(JSON.stringify(f)).records).toEqual([debt, usd, todo]);
  });

  it('wrong values of the new fields are dropped', () => {
    const bad = { ...rec('b'), fields: { title: 'x', direction: 'sideways', currency: 'GBP', happened_utc: 'вчера', no_time: 'yes', done_utc: 5 } };
    const text = JSON.stringify({ format: 'pocket-brain', version: 1, exported_utc: NOW, wallets: [], settings: {}, records: [bad] });
    expect(parseBackup(text).records[0].fields).toEqual({ title: 'x' });
  });
});
