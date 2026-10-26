import { describe, expect, it } from 'vitest';
import { computeTotals, depositEnd, recordWhen, subscriptionNextDue } from '../src/money/totals';
import type { Kind, RecordFields, RecordRow, WalletRow } from '../src/db/types';

const wallets: WalletRow[] = [
  { id: 'a', name: 'Первый', hidden: false, start_balance_minor: 100_000 },
  { id: 'b', name: 'Второй', hidden: true, start_balance_minor: 0 },
  { id: 'c', name: 'Третий', hidden: false, start_balance_minor: 5_000 },
];

let n = 0;
function rec(kind: Kind, wallet_id: string | null, fields: RecordFields, deleted = false): RecordRow {
  n += 1;
  return {
    id: `r${n}`, kind, raw_text: 'x', fields, wallet_id, due_utc: null,
    created_utc: '2026-10-01T00:00:00.000Z', updated_utc: '2026-10-01T00:00:00.000Z', deleted,
  };
}

describe('computeTotals', () => {
  it('start balance only when there are no records', () => {
    const t = computeTotals(wallets, []);
    expect(t.balances).toEqual({ a: 100_000, b: 0, c: 5_000 });
    expect(t.walletsTotal).toBe(105_000);
  });

  it('balance = start + income - expense - transfers out + transfers in', () => {
    const t = computeTotals(wallets, [
      rec('income', 'a', { amount_minor: 8_500_000 }),
      rec('expense', 'a', { amount_minor: 125_000 }),
      rec('transfer', 'a', { amount_minor: 500_000, to_wallet_id: 'b' }),
      rec('income', 'c', { amount_minor: 300 }),
    ]);
    expect(t.balances.a).toBe(100_000 + 8_500_000 - 125_000 - 500_000);
    expect(t.balances.b).toBe(500_000);
    expect(t.balances.c).toBe(5_300);
    expect(t.walletsTotal).toBe(t.balances.a + t.balances.b + t.balances.c);
  });

  it('deleted records are excluded; hidden wallets are still counted', () => {
    const t = computeTotals(wallets, [
      rec('expense', 'a', { amount_minor: 10_000 }, true),
      rec('income', 'b', { amount_minor: 7_000 }),
      rec('held', null, { amount_minor: 9_000, who: 'Х' }, true),
    ]);
    expect(t.balances.a).toBe(100_000);
    expect(t.balances.b).toBe(7_000);
    expect(t.walletsTotal).toBe(112_000);
    expect(t.held.total).toBe(0);
  });

  it('held and subscriptions never move wallet balances; a deposit takes its amount out of its wallet (stage 7)', () => {
    const t = computeTotals(wallets, [
      rec('held', 'a', { amount_minor: 300_000, who: 'Иван', rate: 6.5 }),
      rec('held', null, { amount_minor: 200_000, who: 'Ольга' }),
      rec('deposit', 'b', { amount_minor: 1_000_000, rate: 18 }),
      rec('deposit', null, { amount_minor: 500_000 }),
      rec('subscription', 'a', { amount_minor: 14_900, day: 1 }),
      rec('subscription', null, { amount_minor: 65_000, day: 10 }),
    ]);
    expect(t.balances).toEqual({ a: 100_000, b: -1_000_000, c: 5_000 });
    expect(t.held.total).toBe(500_000);
    expect(t.held.items).toHaveLength(2);
    expect(t.deposits.total).toBe(1_500_000);
    expect(t.subscriptions.monthlyTotal).toBe(79_900);
  });

  it('an old (stage 6) deposit kept in the old «Вклад» wallet moves nothing: that wallet was the deposit itself', () => {
    const withOld: WalletRow[] = [...wallets, { id: 'deposit', name: 'Вклад', hidden: false, start_balance_minor: 0 }];
    const t = computeTotals(withOld, [rec('deposit', 'deposit', { amount_minor: 1_000_000 })]);
    expect(t.balances.deposit).toBe(0);
    expect(t.deposits.total).toBe(1_000_000);
  });

  it('debts and returns move a wallet only when money moved', () => {
    const t = computeTotals(wallets, [
      rec('debt', 'a', { amount_minor: 3_000, who: 'Петя', direction: 'to_me' }), // I lent: -
      rec('debt', 'a', { amount_minor: 2_000, who: 'Оля', direction: 'from_me' }), // I borrowed: +
      rec('debt', null, { amount_minor: 1_500, who: 'Маша', direction: 'to_me' }), // just a fact: no wallet
      rec('repay', 'c', { amount_minor: 500, who: 'Оля', direction: 'by_me' }), // I paid back: -
      rec('repay', 'c', { amount_minor: 1_000, who: 'Петя', direction: 'to_me' }), // paid back to me: +
    ]);
    expect(t.balances).toEqual({ a: 100_000 - 3_000 + 2_000, b: 0, c: 5_000 - 500 + 1_000 });
  });

  it('«Долги и чужие деньги»: one net per person (case and ending ignored) and two totals', () => {
    const t = computeTotals(wallets, [
      rec('debt', 'a', { amount_minor: 3_000, who: 'Петя', direction: 'to_me' }),
      rec('repay', 'a', { amount_minor: 1_000, who: 'петя', direction: 'to_me' }),
      rec('debt', null, { amount_minor: 500, who: 'Оля', direction: 'from_me' }),
      rec('held', null, { amount_minor: 300_000, who: 'Иван', rate: 6.5 }),
      rec('repay', null, { amount_minor: 100_000, who: 'Ивану', direction: 'by_me' }),
      rec('debt', 'a', { amount_minor: 700, who: 'Катя', direction: 'to_me' }),
      rec('repay', 'a', { amount_minor: 700, who: 'Катя', direction: 'to_me' }),
      rec('debt', 'a', { amount_minor: 9_999, who: 'Удалён', direction: 'to_me' }, true),
    ]);
    const net = Object.fromEntries(t.debts.people.map((p) => [p.who, p.net]));
    expect(net).toEqual({ Петя: 2_000, Оля: -500, Иван: -200_000, Катя: 0 });
    expect(t.debts.people.find((p) => p.who === 'Иван')?.items).toHaveLength(2);
    expect(t.debts.owedToMe).toBe(2_000);
    expect(t.debts.iOwe).toBe(500 + 200_000);
  });

  it('dollars and euros are kept in the lists but never added to a ruble sum', () => {
    const usd = { currency: 'USD' as const };
    const t = computeTotals(wallets, [
      rec('expense', 'a', { amount_minor: 10_000, ...usd }),
      rec('income', 'a', { amount_minor: 10_000, currency: 'EUR' }),
      rec('transfer', 'a', { amount_minor: 10_000, to_wallet_id: 'c', ...usd }),
      rec('deposit', 'a', { amount_minor: 10_000, ...usd }),
      rec('held', null, { amount_minor: 10_000, who: 'Иван', ...usd }),
      rec('debt', 'a', { amount_minor: 10_000, who: 'Петя', direction: 'to_me', ...usd }),
      rec('subscription', 'a', { amount_minor: 10_000, day: 1, ...usd }),
    ]);
    expect(t.balances).toEqual({ a: 100_000, b: 0, c: 5_000 });
    expect(t.held).toEqual({ total: 0, items: [expect.objectContaining({ kind: 'held' })] });
    expect(t.deposits.total).toBe(0);
    expect(t.deposits.items).toHaveLength(1);
    expect(t.subscriptions.monthlyTotal).toBe(0);
    expect(t.debts.owedToMe).toBe(0);
    expect(t.debts.iOwe).toBe(0);
    expect(t.debts.people.map((p) => [p.who, p.net, p.items.length])).toEqual(
      expect.arrayContaining([['Иван', 0, 1], ['Петя', 0, 1]]),
    );
  });

  it('records without a wallet or with an unknown wallet count in no wallet; missing amount counts as 0', () => {
    const t = computeTotals(wallets, [
      rec('expense', null, { amount_minor: 1_000 }),
      rec('income', 'zzz', { amount_minor: 1_000 }),
      rec('expense', 'a', {}),
      rec('transfer', 'a', { amount_minor: 2_000 }),
    ]);
    expect(t.balances.a).toBe(100_000 - 2_000);
    expect(t.walletsTotal).toBe(105_000 - 2_000);
  });

  it('a transfer to the same wallet is neutral', () => {
    const t = computeTotals(wallets, [rec('transfer', 'a', { amount_minor: 4_000, to_wallet_id: 'a' })]);
    expect(t.balances.a).toBe(100_000);
  });
});

describe('subscriptionNextDue', () => {
  const now = new Date('2026-10-22T09:00:00Z');
  it('uses the day of month: next occurrence at 12:00 MSK', () => {
    expect(subscriptionNextDue({ day: 25 }, null, now)).toBe('2026-10-25T09:00:00.000Z');
    expect(subscriptionNextDue({ day: 1 }, null, now)).toBe('2026-11-01T09:00:00.000Z');
  });
  it('falls back to the stored due time without a day', () => {
    expect(subscriptionNextDue({}, '2026-12-01T09:00:00.000Z', now)).toBe('2026-12-01T09:00:00.000Z');
    expect(subscriptionNextDue({}, null, now)).toBeNull();
  });
});

describe('dates of a record', () => {
  it('recordWhen: the day it happened («вчера»), else when it was saved', () => {
    const r = rec('expense', 'a', { amount_minor: 1 });
    expect(recordWhen(r)).toBe('2026-10-01T00:00:00.000Z');
    expect(recordWhen({ ...r, fields: { ...r.fields, happened_utc: '2026-09-30T09:00:00.000Z' } })).toBe('2026-09-30T09:00:00.000Z');
  });

  it('depositEnd: start (MSK calendar day) + term in months, «DD.MM.YYYY»; none without a term', () => {
    const d = (fields: RecordFields, created = '2026-10-01T00:00:00.000Z'): RecordRow => ({ ...rec('deposit', 'a', fields), created_utc: created });
    expect(depositEnd(d({ term_months: 12 }))).toBe('01.10.2027');
    expect(depositEnd(d({ term_months: 3 }, '2026-10-25T22:30:00.000Z'))).toBe('26.01.2027'); // 01:30 MSK on the 26th
    expect(depositEnd(d({ term_months: 1 }, '2026-01-31T09:00:00.000Z'))).toBe('28.02.2026'); // no 31 February
    expect(depositEnd(d({ term_months: 6, happened_utc: '2026-09-01T09:00:00.000Z' }))).toBe('01.03.2027');
    expect(depositEnd(d({}))).toBeNull();
  });
});
