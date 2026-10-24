// Pure money math (rules are documented in docs/CODEMAP.md). No DOM, no IndexedDB.
import type { RecordFields, RecordRow, WalletRow } from '../db/types';
import { nextDayOfMonth } from '../parser/time';

export interface Totals {
  /** Wallet id -> balance in kopecks. Hidden wallets are included. */
  balances: Record<string, number>;
  /** Sum over ALL wallets, hidden ones too. */
  walletsTotal: number;
  /** «Чужие деньги». */
  held: { total: number; items: RecordRow[] };
  deposits: { total: number; items: RecordRow[] };
  /** Every subscription is monthly. */
  subscriptions: { monthlyTotal: number; items: RecordRow[] };
}

const amountOf = (r: RecordRow): number => r.fields.amount_minor ?? 0;
const sum = (items: RecordRow[]): number => items.reduce((acc, r) => acc + amountOf(r), 0);

/**
 * balance = start + income - expense - transfers out + transfers in.
 * Deleted records are ignored. held / deposit / subscription / reminder / idea never change a balance.
 * A record with no wallet (or an unknown one) counts in no wallet.
 */
export function computeTotals(wallets: WalletRow[], records: RecordRow[]): Totals {
  const live = records.filter((r) => !r.deleted);
  const balances: Record<string, number> = {};
  for (const w of wallets) balances[w.id] = w.start_balance_minor;
  const add = (walletId: string | null | undefined, delta: number): void => {
    if (walletId && walletId in balances) balances[walletId] += delta;
  };
  for (const r of live) {
    const amount = amountOf(r);
    if (r.kind === 'income') add(r.wallet_id, amount);
    else if (r.kind === 'expense') add(r.wallet_id, -amount);
    else if (r.kind === 'transfer') {
      add(r.wallet_id, -amount);
      add(r.fields.to_wallet_id, amount);
    }
  }
  const held = live.filter((r) => r.kind === 'held');
  const deposits = live.filter((r) => r.kind === 'deposit');
  const subs = live.filter((r) => r.kind === 'subscription');
  return {
    balances,
    walletsTotal: Object.values(balances).reduce((a, b) => a + b, 0),
    held: { total: sum(held), items: held },
    deposits: { total: sum(deposits), items: deposits },
    subscriptions: { monthlyTotal: sum(subs), items: subs },
  };
}

/** Next payment of a subscription: the next `day` of the month at the default hour (MSK); else the stored time. */
export function subscriptionNextDue(fields: RecordFields, dueUtc: string | null, now: Date): string | null {
  if (fields.day) return nextDayOfMonth(fields.day, now);
  return dueUtc;
}
