import { describe, expect, it } from 'vitest';
import { DEFAULT_WALLETS } from '../src/config';
import type { DraftRow, WalletRow } from '../src/db/types';
import type { Learned } from '../src/parser/learned';
import { alreadySentence, savedSentence } from '../src/ui/card-model';
import { buildAutoRecord, defaultWalletId } from '../src/ui/autosave';

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
    expect(build('купил воду за 500', { lastWalletId: 'gold', wallets: hide('gold', 'cash') }).record.wallet_id).toBe('deposit');
    expect(defaultWalletId(hide('cash', 'deposit', 'gold', 'silver', 'tinkoff'), 'gold')).toBeNull();
  });

  it('a hidden wallet named in the phrase is still used and remembered', () => {
    const { record, namedWalletId } = build('купил воду за 500 золотая карта', { wallets: hide('gold') });
    expect(record.wallet_id).toBe('gold');
    expect(namedWalletId).toBe('gold');
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
    const { record } = build('кофе 250', { lastWalletId: 'cash', learned });
    expect(record).toMatchObject({ kind: 'expense', wallet_id: 'gold' });
    expect(record.fields).toMatchObject({ amount_minor: 25000, title: 'кофе' });
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
    const bare = build('пятнице 5000', { lastWalletId: 'silver', learned }).record;
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
