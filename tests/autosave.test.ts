import { describe, expect, it } from 'vitest';
import { DEFAULT_WALLETS } from '../src/config';
import type { DraftRow, RecordRow, WalletRow } from '../src/db/types';
import type { Learned } from '../src/parser/learned';
import { alreadySentence, savedManySentence, savedSentence } from '../src/ui/card-model';
import { buildAutoRecord, buildAutoRecords, defaultWalletId, partId } from '../src/ui/autosave';

const NOW = new Date('2026-10-22T09:00:00Z'); // 12:00 MSK
const wallets: WalletRow[] = DEFAULT_WALLETS.map((w) => ({ id: w.id, name: w.name, hidden: false, start_balance_minor: 0 }));
const norm = (s: string): string => s.replace(/[\s  ]+/g, ' ').trim();

const draft = (text: string): DraftRow => ({ id: 'd1', text, created_utc: NOW.toISOString() });
const build = (text: string, over: { wallets?: WalletRow[]; lastWalletId?: string | null; learned?: Learned } = {}) =>
  buildAutoRecord({ draft: draft(text), wallets: over.wallets ?? wallets, lastWalletId: over.lastWalletId ?? null, learned: over.learned ?? {}, now: NOW });

const hide = (...ids: string[]): WalletRow[] => wallets.map((w) => (ids.includes(w.id) ? { ...w, hidden: true } : w));

describe('buildAutoRecord', () => {
  it('a named wallet: the record, the id of the named wallet and the sentence', () => {
    const { record, namedWalletId } = build('купил воду за пятьсот рублей золотая карта', { lastWalletId: 'silver' });
    expect(record).toMatchObject({ id: 'd1', kind: 'expense', raw_text: 'купил воду за пятьсот рублей золотая карта', wallet_id: 'gold', deleted: false });
    expect(record.fields.amount_minor).toBe(50000);
    expect(record.refine).toBeUndefined();
    expect(namedWalletId).toBe('gold');
    expect(norm(savedSentence(record, wallets, NOW))).toBe('Записал: расход 500,00 ₽, Золотая карта');
  });

  it('no wallet in the phrase: the last used wallet; nothing is "named"', () => {
    const { record, namedWalletId } = build('купил воду за 500', { lastWalletId: 'silver' });
    expect(record.wallet_id).toBe('silver');
    expect(namedWalletId).toBeNull();
  });

  it('no last wallet yet: cash', () => {
    expect(build('купил воду за 500').record.wallet_id).toBe('cash');
  });

  it('the last wallet is missing or hidden: cash, then the first visible wallet', () => {
    expect(build('купил воду за 500', { lastWalletId: 'nope' }).record.wallet_id).toBe('cash');
    expect(build('купил воду за 500', { lastWalletId: 'gold', wallets: hide('gold') }).record.wallet_id).toBe('cash');
    expect(build('купил воду за 500', { lastWalletId: 'gold', wallets: hide('gold', 'cash') }).record.wallet_id).toBe('silver');
    expect(defaultWalletId(hide('cash', 'gold', 'silver', 'tinkoff'), 'gold')).toBeNull();
  });

  it('a hidden wallet named in the phrase is not recognised (stage 7): the default wallet, nothing remembered', () => {
    const { record, namedWalletId } = build('купил воду за 500 золотая карта', { wallets: hide('gold'), lastWalletId: 'silver' });
    expect(record.wallet_id).toBe('silver');
    expect(namedWalletId).toBeNull();
  });

  it('learned wallet beats the last wallet; a named wallet beats both', () => {
    const learned: Learned = { 'кофе|expense': { wallet_id: 'gold', updated_utc: NOW.toISOString() } };
    const viaLearned = build('кофе 250 рублей', { lastWalletId: 'cash', learned });
    expect(viaLearned.record.wallet_id).toBe('gold');
    expect(viaLearned.namedWalletId).toBeNull();
    const named = build('кофе 250 рублей серебряная карта', { lastWalletId: 'cash', learned });
    expect(named.record.wallet_id).toBe('silver');
    expect(named.namedWalletId).toBe('silver');
  });

  it('a learned kind and wallet apply to a bare phrase', () => {
    const learned: Learned = { 'кофе|idea': { to_kind: 'expense', wallet_id: 'gold', updated_utc: NOW.toISOString() } };
    const { record } = build('кофе 250 вкусный', { lastWalletId: 'cash', learned });
    expect(record).toMatchObject({ kind: 'expense', wallet_id: 'gold' });
    expect(record.fields).toMatchObject({ amount_minor: 25000, title: 'кофе вкусный' });
    expect(record.refine).toBeUndefined();
  });

  it('a reminder has no wallet; the sentence says when', () => {
    const { record, namedWalletId } = build('напомни завтра в 19:00 позвонить маме', { lastWalletId: 'gold' });
    expect(record.kind).toBe('reminder');
    expect(record.wallet_id).toBeNull();
    expect(record.due_utc).toBe('2026-10-23T16:00:00.000Z');
    expect(namedWalletId).toBeNull();
    expect(savedSentence(record, wallets, NOW)).toBe('Записал: напоминание, завтра 19:00 МСК');
    expect(alreadySentence(record, wallets, NOW)).toBe('Уже записано: напоминание, завтра 19:00 МСК');
  });

  it('a transfer: only the source wallet gets the default', () => {
    const { record } = build('перекинул пять тысяч с золотой карты на наличные', { lastWalletId: 'silver' });
    expect(record).toMatchObject({ kind: 'transfer', wallet_id: 'gold' });
    expect(record.fields.to_wallet_id).toBe('cash');
    // A transfer that only the corrections memory made: no wallets in the phrase, so the source gets the default.
    const learned: Learned = { 'пятни|idea': { to_kind: 'transfer', updated_utc: NOW.toISOString() } };
    const bare = build('5000 к пятнице', { lastWalletId: 'silver', learned }).record;
    expect(bare).toMatchObject({ kind: 'transfer', wallet_id: 'silver' });
    expect(bare.fields.to_wallet_id).toBeUndefined();
  });

  it('an idea gets no wallet and says «мысль»', () => {
    const { record, namedWalletId } = build('идея: сделать скворечник', { lastWalletId: 'gold' });
    expect(record).toMatchObject({ kind: 'idea', wallet_id: null });
    expect(record.refine).toBeUndefined();
    expect(namedWalletId).toBeNull();
    expect(savedSentence(record, wallets, NOW)).toBe('Записал: мысль');
  });

  it('an unsure phrase is saved as a thought and marked for the model; the text is kept', () => {
    const { record } = build('что-то непонятное про вторник');
    expect(record.kind).toBe('idea');
    expect(record.raw_text).toBe('что-то непонятное про вторник');
    expect(record.refine).toBe('pending');
  });

  it('a money phrase without an amount and a reminder without a time are marked too', () => {
    expect(build('подписка на облако').record.refine).toBe('pending');
    expect(build('напомни позвонить маме').record.refine).toBe('pending');
    expect(build('напомни позвонить маме').record.kind).toBe('reminder');
  });

  it('the creation time is the moment the phrase was said', () => {
    const d: DraftRow = { id: 'd2', text: 'купил воду за 500', created_utc: '2026-10-22T08:00:00.000Z' };
    const { record } = buildAutoRecord({ draft: d, wallets, lastWalletId: null, learned: {}, now: NOW });
    expect(record.created_utc).toBe('2026-10-22T08:00:00.000Z');
    expect(record.updated_utc).toBe(NOW.toISOString());
  });
});

describe('stage 7: several records, debts, currency and past days', () => {
  const many = (text: string, over: { lastWalletId?: string | null; records?: RecordRow[] } = {}) =>
    buildAutoRecords({ draft: draft(text), wallets, lastWalletId: over.lastWalletId ?? 'silver', learned: {}, now: NOW, records: over.records });

  it('one phrase with two amounts → two records with ids d1 and d1-2, one creation time, never sent to the model', () => {
    const { records } = many('кофе 300 и круассан 250');
    expect(records.map((r) => [r.id, r.kind, r.fields.amount_minor, r.wallet_id])).toEqual([
      ['d1', 'expense', 30000, 'silver'],
      ['d1-2', 'expense', 25000, 'silver'],
    ]);
    expect(records.every((r) => r.created_utc === NOW.toISOString() && r.refine === undefined)).toBe(true);
    expect(partId('d1', 0)).toBe('d1');
    expect(partId('d1', 2)).toBe('d1-3');
    expect(norm(savedManySentence(records, wallets, NOW))).toMatch(/^Записал 2 записи: /);
  });

  it('a debt that is only a fact gets no wallet, not even the last one; a lent one moves the last wallet', () => {
    const fact = many('Маша должна мне 1500').records[0];
    expect(fact).toMatchObject({ kind: 'debt', wallet_id: null });
    expect(fact.fields).toMatchObject({ who: 'Маша', amount_minor: 150000, direction: 'to_me' });
    expect(many('одолжил Пете 3000').records[0]).toMatchObject({ kind: 'debt', wallet_id: 'silver' });
  });

  it('returning money that was only kept («чужие деньги») takes nothing from a wallet; returning a debt does', () => {
    const held: RecordRow = {
      id: 'h', kind: 'held', raw_text: 'x', fields: { who: 'Иван', amount_minor: 500000 }, wallet_id: null, due_utc: null,
      created_utc: NOW.toISOString(), updated_utc: NOW.toISOString(), deleted: false,
    };
    const text = 'отдал Ивану 5000 его деньги';
    expect(many(text, { records: [held] }).records[0]).toMatchObject({ kind: 'repay', wallet_id: null });
    const owe = { ...held, id: 'o', kind: 'debt' as const, fields: { who: 'Иван', amount_minor: 500000, direction: 'from_me' as const } };
    expect(many(text, { records: [held, owe] }).records[0]).toMatchObject({ kind: 'repay', wallet_id: 'silver' });
    expect(many(text).records[0]).toMatchObject({ kind: 'repay', wallet_id: 'silver' });
  });

  it('review 6: once the held money was fully returned, a later payment to the same person takes a wallet', () => {
    const base: RecordRow = {
      id: 'h', kind: 'held', raw_text: 'x', fields: { who: 'Иван', amount_minor: 500000 }, wallet_id: null, due_utc: null,
      created_utc: NOW.toISOString(), updated_utc: NOW.toISOString(), deleted: false,
    };
    const back = { ...base, id: 'b', kind: 'repay' as const, fields: { who: 'Иван', amount_minor: 500000, direction: 'by_me' as const } };
    expect(many('вернул Ивану 2000', { records: [base, back] }).records[0]).toMatchObject({ kind: 'repay', wallet_id: 'silver' });
    const part = { ...back, fields: { ...back.fields, amount_minor: 200000 } };
    expect(many('вернул Ивану 2000', { records: [base, part] }).records[0]).toMatchObject({ kind: 'repay', wallet_id: null });
  });

  it('currency and the day it happened are carried into the record; no due time for a past expense', () => {
    const usd = many('потратил 100 долларов на сувениры').records[0];
    expect(usd.fields.currency).toBe('USD');
    const past = many('вчера потратил 500 на такси').records[0];
    expect(past.fields.happened_utc).toBe('2026-10-21T09:00:00.000Z');
    expect(past.due_utc).toBeNull();
  });
});
