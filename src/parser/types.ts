import type { WalletRef } from '../config';

export type Kind =
  | 'reminder'
  | 'expense'
  | 'income'
  | 'transfer'
  | 'held'
  | 'deposit'
  | 'subscription'
  | 'idea';

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
}

export interface ParseResult {
  kind: Kind;
  /** 0..1; below 0.5 means "not sure" (kind falls back to idea). */
  confidence: number;
  fields: ParsedFields;
  tags: string[];
  /** The input text exactly as received (never lost). */
  raw_text: string;
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
}

export type Rule = (ctx: ParseContext) => RuleMatch | null;
