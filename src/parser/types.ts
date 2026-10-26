import type { WalletRef } from '../config';

export type Kind =
  | 'reminder'
  | 'expense'
  | 'income'
  | 'transfer'
  | 'held'
  | 'deposit'
  | 'subscription'
  | 'debt'
  | 'repay'
  | 'idea';

/** debt: `to_me` = they owe me, `from_me` = I owe them. repay: `by_me` = I gave it back, `to_me` = they gave it back. */
export type Direction = 'to_me' | 'from_me' | 'by_me';

/** No field = rubles. Records in another currency are never added to a ruble sum. */
export type Currency = 'USD' | 'EUR';

export interface ParsedFields {
  /** Reminder: what to do; subscription: what the payment is; other kinds: a short label. */
  title?: string;
  /** Integer kopecks. */
  amount_minor?: number;
  /** Canonical wallet name (source wallet for transfers). */
  wallet?: string;
  to_wallet?: string;
  /** ISO UTC instant, e.g. 2026-10-23T16:00:00.000Z. */
  due_utc?: string;
  who?: string;
  /** Percent, e.g. 6.5. */
  rate?: number;
  term_months?: number;
  /** Day of month (subscriptions). */
  day?: number;
  /** Debts and returns: who owes whom (see Direction). */
  direction?: Direction;
  currency?: Currency;
  /** A past day for money («вчера потратил 500»): ISO UTC. NOT due_utc, so it never becomes a reminder. */
  happened_utc?: string;
  /** No hour was said: due_utc is 12:00 MSK of that day. */
  no_time?: boolean;
}

export interface ParseResult {
  kind: Kind;
  /** 0..1; below 0.5 means "not sure" (kind falls back to idea). */
  confidence: number;
  fields: ParsedFields;
  tags: string[];
  /** The input text exactly as received (never lost). */
  raw_text: string;
  /** Parser hint, never stored: no money moved («Маша должна мне 1500»), so autosave gives no default wallet. */
  walletless?: true;
}

/** Half-open character range [start, end) in the normalized text. */
export interface Span {
  start: number;
  end: number;
}

/** Everything a rule needs, computed once per parse. */
export interface ParseContext {
  raw: string;
  /** Number words → digits, case preserved (used for titles and names). */
  norm: string;
  /** `norm` lower-cased with ё→е; same length as `norm`, positions map 1:1. */
  lower: string;
  now: Date;
  wallets: WalletRef[];
}

export interface RuleMatch {
  kind: Kind;
  confidence: number;
  fields: ParsedFields;
  walletless?: true;
}

export type Rule = (ctx: ParseContext) => RuleMatch | null;
