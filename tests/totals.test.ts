import { describe, expect, it } from 'vitest';
import { computeTotals, subscriptionNextDue } from '../src/money/totals';
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

  it('held, deposits and subscriptions never move wallet balances', () => {
    const t = computeTotals(wallets, [
      rec('held', 'a', { amount_minor: 300_000, who: 'Иван', rate: 6.5 }),
      rec('held', null, { amount_minor: 200_000, who: 'Ольга' }),
      rec('deposit', 'b', { amount_minor: 1_000_000, rate: 18 }),
      rec('deposit', null, { amount_minor: 500_000 }),
      rec('subscription', 'a', { amount_minor: 14_900, day: 1 }),
      rec('subscription', null, { amount_minor: 65_000, day: 10 }),
    ]);
    expect(t.balances).toEqual({ a: 100_000, b: 0, c: 5_000 });
    expect(t.held.total).toBe(500_000);
    expect(t.held.items).toHaveLength(2);
    expect(t.deposits.total).toBe(1_500_000);
    expect(t.subscriptions.monthlyTotal).toBe(79_900);
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
