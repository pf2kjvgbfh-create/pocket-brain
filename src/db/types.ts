import type { Currency, Direction, Kind } from '../parser/types';

export type { Currency, Direction, Kind };

/** Everything the card can edit, except the wallet and the time (those are columns of the record). */
export interface RecordFields {
  title?: string;
  /** Integer kopecks. */
  amount_minor?: number;
  /** Transfer target; an id, so a rename never breaks totals. */
  to_wallet_id?: string;
  who?: string;
  /** Percent, e.g. 6.5. */
  rate?: number;
  term_months?: number;
  /** Day of month (subscriptions). */
  day?: number;
  tags?: string[];
  /** Debts and returns: `to_me` / `from_me` (debt), `by_me` / `to_me` (repay). */
  direction?: Direction;
  /** Dollars / euros: never added to a ruble sum. No field = rubles. */
  currency?: Currency;
  /** A past day of the money («вчера потратил 500»), ISO UTC; lists and totals sort by it before created_utc. */
  happened_utc?: string;
  /** Reminder said without an hour: due_utc is 12:00 MSK of that day. */
  no_time?: boolean;
  /** Reminder marked done (stage 7 UI), ISO UTC. */
  done_utc?: string;
}

export interface RecordRow {
  id: string;
  kind: Kind;
  raw_text: string;
  fields: RecordFields;
  wallet_id: string | null;
  /** ISO UTC. */
  due_utc: string | null;
  created_utc: string;
  updated_utc: string;
  deleted: boolean;
  /** The rules were unsure; the local model (stage 5) may re-sort this record. Cleared when the owner edits it. */
  refine?: 'pending';
}

export interface WalletRow {
  id: string;
  name: string;
  hidden: boolean;
  start_balance_minor: number;
}

export interface DraftRow {
  id: string;
  text: string;
  created_utc: string;
}
