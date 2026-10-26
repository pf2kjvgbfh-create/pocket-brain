// Pure money math (rules are documented in docs/CODEMAP.md). No DOM, no IndexedDB.
import { MSK_OFFSET_MIN, OLD_DEPOSIT_WALLET_ID } from '../config';
import type { RecordFields, RecordRow, WalletRow } from '../db/types';
import { personKey } from '../parser/names';
import { nextDayOfMonth } from '../parser/time';

/** One person in «Долги и чужие деньги»: + they owe me, − I keep their money or owe them. */
export interface PersonDebt {
  /** Grouping key (name without case and ending): «Петя» and «петя», «Иван» and «Ивану» are one person. */
  key: string;
  /** Name as first written. */
  who: string;
  net: number;
  /** Their debt / repay / held records, oldest first (dollars and euros are listed but not counted). */
  items: RecordRow[];
}

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
  /** «Долги и чужие деньги»: owedToMe = sum of positive nets, iOwe = sum of negative nets (as a positive number). */
  debts: { people: PersonDebt[]; owedToMe: number; iOwe: number };
}

/** Dollars and euros never enter a ruble sum (DECISIONS stage 7, item 4). */
const inRubles = (r: RecordRow): boolean => r.fields.currency === undefined;
const amountOf = (r: RecordRow): number => (inRubles(r) ? r.fields.amount_minor ?? 0 : 0);
const sum = (items: RecordRow[]): number => items.reduce((acc, r) => acc + amountOf(r), 0);

/** When it happened («вчера потратил 500»), else when it was saved: lists and totals by date use this. */
export function recordWhen(r: RecordRow): string {
  return r.fields.happened_utc ?? r.created_utc;
}

/** Wallet changes of one record: [walletId, delta][]. */
function walletDeltas(r: RecordRow): [string | null | undefined, number][] {
  const amount = amountOf(r);
  const dir = r.fields.direction;
  switch (r.kind) {
    case 'income':
      return [[r.wallet_id, amount]];
    case 'expense':
      return [[r.wallet_id, -amount]];
    case 'deposit': // an old (stage 6) deposit kept in the old «Вклад» wallet: that wallet WAS the deposit
      return r.wallet_id === OLD_DEPOSIT_WALLET_ID ? [] : [[r.wallet_id, -amount]];
    case 'transfer':
      return [[r.wallet_id, -amount], [r.fields.to_wallet_id, amount]];
    case 'debt': // I lent (to_me): money left; I borrowed (from_me): money came
      return [[r.wallet_id, dir === 'from_me' ? amount : -amount]];
    case 'repay': // they paid me back (to_me): money came; I paid back (by_me): money left
      return [[r.wallet_id, dir === 'to_me' ? amount : -amount]];
    default:
      return [];
  }
}

/** + they owe me / − I owe them or keep their money. */
export function personDelta(r: RecordRow): number {
  const amount = amountOf(r);
  const dir = r.fields.direction;
  if (r.kind === 'held') return -amount;
  if (r.kind === 'debt') return dir === 'from_me' ? -amount : amount;
  if (r.kind === 'repay') return dir === 'to_me' ? -amount : amount;
  return 0;
}

function debtsOf(live: RecordRow[]): Totals['debts'] {
  const byKey = new Map<string, PersonDebt>();
  const ordered = live
    .filter((r) => r.kind === 'held' || r.kind === 'debt' || r.kind === 'repay')
    .sort((a, b) => (recordWhen(a) < recordWhen(b) ? -1 : recordWhen(a) > recordWhen(b) ? 1 : 0));
  for (const r of ordered) {
    const who = (r.fields.who ?? '').trim();
    const key = personKey(who);
    const person = byKey.get(key) ?? { key, who: who || '?', net: 0, items: [] };
    person.net += personDelta(r);
    person.items.push(r);
    byKey.set(key, person);
  }
  const people = [...byKey.values()];
  return {
    people,
    owedToMe: people.reduce((acc, p) => acc + Math.max(p.net, 0), 0),
    iOwe: people.reduce((acc, p) => acc + Math.max(-p.net, 0), 0),
  };
}

/**
 * balance = start + income − expense − deposits − transfers out + transfers in ± debts and returns (DECISIONS stage 7).
 * Deleted records are ignored; held / subscription / reminder / idea never change a balance; dollars and euros count nowhere.
 * A record with no wallet (or an unknown one) counts in no wallet.
 */
export function computeTotals(wallets: WalletRow[], records: RecordRow[]): Totals {
  const live = records.filter((r) => !r.deleted);
  const balances: Record<string, number> = {};
  for (const w of wallets) balances[w.id] = w.start_balance_minor;
  for (const r of live) {
    for (const [walletId, delta] of walletDeltas(r)) {
      if (walletId && walletId in balances) balances[walletId] += delta;
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
    debts: debtsOf(live),
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** End of a deposit with a term: its start day (MSK calendar) + term months, «DD.MM.YYYY»; null without a term. */
export function depositEnd(r: RecordRow): string | null {
  const months = r.fields.term_months;
  if (!months) return null;
  const msk = new Date(Date.parse(recordWhen(r)) + MSK_OFFSET_MIN * 60_000);
  const total = msk.getUTCMonth() + months;
  const y = msk.getUTCFullYear() + Math.floor(total / 12);
  const mo = total % 12;
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const d = Math.min(msk.getUTCDate(), lastDay);
  return `${pad(d)}.${pad(mo + 1)}.${y}`;
}

/** Next payment of a subscription: the next `day` of the month at the default hour (MSK); else the stored time. */
export function subscriptionNextDue(fields: RecordFields, dueUtc: string | null, now: Date): string | null {
  if (fields.day) return nextDayOfMonth(fields.day, now);
  return dueUtc;
}
