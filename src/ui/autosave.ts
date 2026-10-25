// Autosave (owner decision: NO CONFIRMATION CARDS): a phrase becomes a record at once, with no question asked.
// Pure: no DOM and no database, so the rules (wallet defaults, corrections memory, unsure flag) are unit-tested.
import type { DraftRow, RecordRow, WalletRow } from '../db/types';
import { walletIdByName, walletRefs } from '../db/wallets';
import { needsModel } from '../parser/confidence';
import { parse } from '../parser/index';
import { applyLearned, type Learned } from '../parser/learned';
import { KIND_FIELDS, recordFromState, stateFromParse } from './card-model';

/** The last used wallet, else «Наличные», else the first visible wallet; a hidden or missing wallet is skipped. */
export function defaultWalletId(wallets: WalletRow[], lastWalletId: string | null | undefined): string | null {
  const visible = (id: string | null | undefined): string | undefined => wallets.find((w) => w.id === id && !w.hidden)?.id;
  return visible(lastWalletId) ?? visible('cash') ?? wallets.find((w) => !w.hidden)?.id ?? null;
}

export interface AutoInput {
  draft: DraftRow;
  wallets: WalletRow[];
  lastWalletId: string | null | undefined;
  learned: Learned;
  now: Date;
}

export interface AutoResult {
  record: RecordRow;
  /** The wallet the PHRASE named (not a default, not learned): it becomes the new «last wallet». */
  namedWalletId: string | null;
}

/** Wallet order: named in the phrase > learned > last used > cash. For a transfer only the source gets a default. */
export function buildAutoRecord({ draft, wallets, lastWalletId, learned, now }: AutoInput): AutoResult {
  const parsed = parse(draft.text, new Date(draft.created_utc), walletRefs(wallets));
  const result = applyLearned(parsed, learned, wallets);
  const state = stateFromParse(draft.id, result, wallets);
  state.createdUtc = draft.created_utc;
  const hasWallet = KIND_FIELDS[result.kind].includes('wallet');
  if (hasWallet && !state.walletId) state.walletId = defaultWalletId(wallets, lastWalletId) ?? '';
  const record = recordFromState(state, now);
  return {
    record: needsModel(result) ? { ...record, refine: 'pending' } : record,
    namedWalletId: hasWallet ? walletIdByName(wallets, parsed.fields.wallet) : null,
  };
}
