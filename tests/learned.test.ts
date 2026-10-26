import { describe, expect, it } from 'vitest';
import { DEFAULT_WALLETS, LEARNED_MAX } from '../src/config';
import type { RecordRow, WalletRow } from '../src/db/types';
import { walletRefs } from '../src/db/wallets';
import { parse } from '../src/parser/index';
import { applyLearned, keywordStems, learnFromEdit, sanitizeLearned, type Learned } from '../src/parser/learned';

const NOW = new Date('2026-10-22T09:00:00Z');
const wallets: WalletRow[] = DEFAULT_WALLETS.map((w) => ({ id: w.id, name: w.name, hidden: false, start_balance_minor: 0 }));
const refs = walletRefs(wallets);

const rec = (over: Partial<RecordRow>): RecordRow => ({
  id: 'r1', kind: 'idea', raw_text: 'кофе 300 вкусный', fields: {}, wallet_id: null, due_utc: null,
  created_utc: NOW.toISOString(), updated_utc: NOW.toISOString(), deleted: false, ...over,
});

const later = (min: number): Date => new Date(NOW.getTime() + min * 60_000);
const run = (text: string, learned: Learned, ws = wallets) => applyLearned(parse(text, NOW, walletRefs(ws)), learned, ws);

describe('keywordStems', () => {
  it('cuts two letters off long words, keeps the short ones, folds ё', () => {
    expect(keywordStems('Кофе')).toEqual(['кофе']);
    expect(keywordStems('яндекс музыка')).toEqual(['янде', 'музы']);
    expect(keywordStems('ёлки')).toEqual(['елки']);
  });

  it('stopwords are never learned: verbs, prepositions, money words, dates, wallet aliases', () => {
    const stop = [
      'купил', 'купила', 'потратил', 'потратила', 'заплатил', 'за', 'на', 'в', 'рублей', 'рубля', 'руб', 'тысяч', 'тысячи',
      'напомни', 'завтра', 'сегодня', 'золотая', 'золотой', 'наличные', 'наличными', 'серебряной', 'тинькофф', 'вклад', 'карту', 'карты',
    ];
    for (const w of stop) expect(keywordStems(w), w).toEqual([]);
    expect(keywordStems('купил воду за 500 рублей на золотую карту')).toEqual(['воду']);
  });

  it('digits, short words and number words are not keywords', () => {
    expect(keywordStems('мы 12 пятьсот ту')).toEqual([]);
    expect(keywordStems('кофе 300')).toEqual(['кофе']);
  });
});

describe('learning from an edit', () => {
  it('«кофе 300 вкусный» (rules: an idea) edited to a wallet: the next «кофе 250 вкусный» gets that wallet and becomes an expense', () => {
    const learned = learnFromEdit({
      before: rec({}), after: rec({ kind: 'expense', wallet_id: 'gold' }), learned: {}, wallets, now: later(1),
    });
    expect(learned['кофе|idea']).toEqual({ to_kind: 'expense', wallet_id: 'gold', updated_utc: later(1).toISOString() });
    const next = run('кофе 250 вкусный', learned);
    expect(next.kind).toBe('expense');
    expect(next.fields.wallet).toBe('Золотая карта');
    expect(next.fields.amount_minor).toBe(25000);
    expect(next.fields.title).toBe('кофе вкусный');
    expect(next.raw_text).toBe('кофе 250 вкусный');
  });

  it('«яндекс плюс 299» (idea) edited to a subscription: «яндекс музыка 199» becomes a subscription', () => {
    const learned = learnFromEdit({
      before: rec({ raw_text: 'яндекс плюс 299' }), after: rec({ raw_text: 'яндекс плюс 299', kind: 'subscription' }),
      learned: {}, wallets, now: later(1),
    });
    const next = run('яндекс музыка 199', learned);
    expect(next.kind).toBe('subscription');
    expect(next.fields.amount_minor).toBe(19900);
    expect(next.fields.title).toBe('яндекс музыка');
    expect(next.fields.wallet).toBeUndefined();
  });

  it('a wallet named in the phrase beats the learned wallet', () => {
    const learned: Learned = { 'кофе|expense': { wallet_id: 'gold', updated_utc: later(1).toISOString() } };
    const next = run('кофе 250 серебряная карта', learned);
    expect(next.kind).toBe('expense');
    expect(next.fields.wallet).toBe('Серебряная карта');
    expect(run('кофе 250 рублей', learned).fields.wallet).toBe('Золотая карта');
  });

  it('a learned hidden or missing wallet is ignored', () => {
    const learned: Learned = { 'кофе|expense': { wallet_id: 'gold', updated_utc: later(1).toISOString() } };
    const hidden = wallets.map((w) => (w.id === 'gold' ? { ...w, hidden: true } : w));
    expect(run('кофе 250 рублей', learned, hidden).fields.wallet).toBeUndefined();
    expect(run('кофе 250 рублей', { 'кофе|expense': { wallet_id: 'nope', updated_utc: 'x' } }).fields.wallet).toBeUndefined();
  });

  it('the newest matching entry wins', () => {
    const learned: Learned = {
      'кофе|idea': { to_kind: 'expense', wallet_id: 'gold', updated_utc: later(1).toISOString() },
      'старба|idea': { to_kind: 'expense', wallet_id: 'silver', updated_utc: later(2).toISOString() },
    };
    expect(run('кофе 300 в старбакс', learned).fields.wallet).toBe('Серебряная карта');
    expect(run('кофе 300 дома', learned).fields.wallet).toBe('Золотая карта');
  });

  it('only the rules kind matters: an entry for another kind does not apply', () => {
    const learned: Learned = { 'кофе|idea': { to_kind: 'expense', wallet_id: 'gold', updated_utc: later(1).toISOString() } };
    const plain = parse('кофе 180 рублей наличка', NOW, refs);
    expect(plain.kind).toBe('expense');
    expect(applyLearned(plain, learned, wallets)).toEqual(plain);
  });

  it('no match: the result is returned unchanged', () => {
    const p = parse('надо бы разобраться с фотографиями', NOW, refs);
    expect(applyLearned(p, { 'кофе|idea': { to_kind: 'expense', updated_utc: 'x' } }, wallets)).toEqual(p);
  });

  it('changing only the wallet later keeps the learned kind', () => {
    const first = learnFromEdit({ before: rec({}), after: rec({ kind: 'expense', wallet_id: 'gold' }), learned: {}, wallets, now: later(1) });
    const second = learnFromEdit({
      before: rec({ kind: 'expense', wallet_id: 'gold' }), after: rec({ kind: 'expense', wallet_id: 'cash' }),
      learned: first, wallets, now: later(2),
    });
    expect(second['кофе|idea']).toEqual({ to_kind: 'expense', wallet_id: 'cash', updated_utc: later(2).toISOString() });
  });

  it('changing only the kind keeps the learned wallet', () => {
    const first = learnFromEdit({ before: rec({}), after: rec({ kind: 'expense', wallet_id: 'gold' }), learned: {}, wallets, now: later(1) });
    const second = learnFromEdit({
      before: rec({ kind: 'expense', wallet_id: 'gold' }), after: rec({ kind: 'income', wallet_id: 'gold' }),
      learned: first, wallets, now: later(2),
    });
    expect(second['кофе|idea']).toEqual({ to_kind: 'income', wallet_id: 'gold', updated_utc: later(2).toISOString() });
  });

  it('an edit that changes neither kind nor wallet learns nothing', () => {
    const out = learnFromEdit({ before: rec({}), after: rec({ fields: { title: 'кофе' } }), learned: {}, wallets, now: later(1) });
    expect(out).toEqual({});
  });

  it('going back to what the rules say, with no wallet, forgets the entry', () => {
    const first = learnFromEdit({ before: rec({}), after: rec({ kind: 'expense', wallet_id: 'gold' }), learned: {}, wallets, now: later(1) });
    const second = learnFromEdit({
      before: rec({ kind: 'expense', wallet_id: 'gold' }), after: rec({ kind: 'idea', wallet_id: null }),
      learned: first, wallets, now: later(2),
    });
    expect(second['кофе|idea']).toBeUndefined();
  });

  it('stopwords are not stored', () => {
    const learned = learnFromEdit({
      before: rec({ raw_text: 'купил воду за 500 рублей', kind: 'expense', wallet_id: 'cash' }),
      after: rec({ raw_text: 'купил воду за 500 рублей', kind: 'expense', wallet_id: 'gold' }),
      learned: {}, wallets, now: later(1),
    });
    expect(Object.keys(learned)).toEqual(['воду|expense']);
  });

  it('the key uses the rules kind, not the stored kind', () => {
    const learned = learnFromEdit({
      before: rec({ raw_text: 'кофе 300 золотая карта', kind: 'expense', wallet_id: 'gold' }),
      after: rec({ raw_text: 'кофе 300 золотая карта', kind: 'expense', wallet_id: 'cash' }),
      learned: {}, wallets, now: later(1),
    });
    expect(Object.keys(learned)).toEqual(['кофе|expense']);
  });

  it('the store is capped: the oldest entries are dropped', () => {
    const full: Learned = {};
    for (let i = 0; i < LEARNED_MAX; i += 1) {
      full[`слово${i}|idea`] = { to_kind: 'expense', updated_utc: new Date(NOW.getTime() + i * 1000).toISOString() };
    }
    const out = learnFromEdit({
      before: rec({ raw_text: 'кофе молоко' }), after: rec({ raw_text: 'кофе молоко', kind: 'expense' }),
      learned: full, wallets, now: later(60),
    });
    expect(Object.keys(out)).toHaveLength(LEARNED_MAX);
    expect(out['кофе|idea']).toBeDefined();
    expect(out['моло|idea']).toBeDefined();
    expect(out['слово0|idea']).toBeUndefined();
    expect(out['слово1|idea']).toBeUndefined();
    expect(out[`слово${LEARNED_MAX - 1}|idea`]).toBeDefined();
  });
});

describe('sanitizeLearned', () => {
  it('keeps well-formed entries and drops the rest', () => {
    const out = sanitizeLearned({
      'a|idea': { to_kind: 'expense', wallet_id: 'gold', updated_utc: '2026-10-22T09:00:00.000Z' },
      'b|idea': { to_kind: 'nonsense', wallet_id: 5, updated_utc: '2026-10-22T09:00:00.000Z' },
      'c|idea': { to_kind: 'income', updated_utc: 7 },
      'd|idea': 'text',
      'e|idea': { to_kind: 'income', wallet_id: 'cash', updated_utc: '2026-10-22T09:00:00.000Z', extra: 'x' },
    });
    expect(out).toEqual({
      'a|idea': { to_kind: 'expense', wallet_id: 'gold', updated_utc: '2026-10-22T09:00:00.000Z' },
      'e|idea': { to_kind: 'income', wallet_id: 'cash', updated_utc: '2026-10-22T09:00:00.000Z' },
    });
  });

  it('anything that is not a plain object gives an empty store', () => {
    for (const v of [null, undefined, 'x', 5, [], [1, 2]]) expect(sanitizeLearned(v)).toEqual({});
  });
});
