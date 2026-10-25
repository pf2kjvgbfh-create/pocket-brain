import type { Kind } from '../parser/types';

export type { Kind };

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
