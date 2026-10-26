// What a model answer does to a saved record. Pure (no DOM, no database). The model only names the KIND; amounts,
// dates and wallets are read from the text by the rules (invariant 11: model output is untrusted, never invents data).
import type { RecordRow, WalletRow } from '../db/types';
import { walletRefs } from '../db/wallets';
import { findAmount } from '../parser/money';
import { fold, normalize } from '../parser/normalize';
import { findTags } from '../parser/rules/idea';
import { cutTitle } from '../parser/text';
import { findWhen } from '../parser/when';
import type { Kind, ParseResult } from '../parser/types';
import { findWallets, firstWallet } from '../parser/wallets';
import { defaultWalletId } from '../ui/autosave';
import { recordFromState, stateFromParse } from '../ui/card-model';

/** The only kinds the rules can fill from a plain phrase once they are told the kind. */
const REFINABLE: readonly Kind[] = ['expense', 'income', 'reminder'];

/** Rules fields for `kind`, or null when the text has nothing to fill it with (then the record stays an idea). */
function parseAs(kind: Kind, text: string, said: Date, wallets: WalletRow[]): ParseResult | null {
  const norm = normalize(text);
  const lower = fold(norm);
  const base = { kind, confidence: 0.7, tags: findTags(lower).tags, raw_text: text };
  if (kind === 'reminder') {
    // Same reading as the rules: own hour and part of the day, then chrono for the day; no hour → 12:00 + no_time.
    const when = findWhen(norm, said);
    if (!when) return null;
    return { ...base, fields: { title: cutTitle(norm, when.spans), due_utc: when.dueUtc, no_time: when.noTime || undefined } };
  }
  const amount = findAmount(lower);
  if (!amount) return null;
  const named = findWallets(lower, walletRefs(wallets));
  return { ...base, fields: { title: cutTitle(norm, [amount, ...named]), amount_minor: amount.minor, wallet: firstWallet(named)?.name } };
}

export interface RefineInput {
  record: RecordRow;
  /** The model's answer (null = not valid). */
  kind: Kind | null;
  wallets: WalletRow[];
  lastWalletId: string | null | undefined;
  now: Date;
}

/** The re-sorted record (same id and creation time, flag cleared), or null when nothing should change. */
export function refineRecord({ record, kind, wallets, lastWalletId, now }: RefineInput): RecordRow | null {
  if (record.refine !== 'pending' || record.deleted || record.kind !== 'idea') return null;
  if (!kind || !REFINABLE.includes(kind)) return null;
  const parsed = parseAs(kind, record.raw_text, new Date(record.created_utc), wallets);
  if (!parsed) return null;
  const state = stateFromParse(record.id, parsed, wallets);
  state.createdUtc = record.created_utc;
  if (kind !== 'reminder' && !state.walletId) state.walletId = defaultWalletId(wallets, lastWalletId) ?? '';
  return recordFromState(state, now);
}
