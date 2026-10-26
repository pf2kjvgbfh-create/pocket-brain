// Autosave (owner decision: NO CONFIRMATION CARDS): a phrase becomes a record at once, with no question asked.
// Pure: no DOM and no database, so the rules (wallet defaults, corrections memory, unsure flag) are unit-tested.
import type { DraftRow, RecordRow, WalletRow } from '../db/types';
import { walletIdByName, walletRefs } from '../db/wallets';
import { needsModel } from '../parser/confidence';
import { parseMany } from '../parser/index';
import { applyLearned, type Learned } from '../parser/learned';
import { personDelta } from '../money/totals';
import { personKey } from '../parser/names';
import type { ParseResult } from '../parser/types';
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
  /** Live records: «вернул Ивану его деньги» moves no wallet when Ivan's money was only kept (held). */
  records?: RecordRow[];
}

export interface AutoResult {
  record: RecordRow;
  /** The wallet the PHRASE named (not a default, not learned): it becomes the new «last wallet». */
  namedWalletId: string | null;
}

export interface AutoResults {
  /** One per amount («кофе 300 и круассан 250» → 2); ids `draft.id`, `draft.id-2`, … */
  records: RecordRow[];
  namedWalletId: string | null;
  /** A bank named as a transfer target with no wallet yet («перевёл 10к на сбер» → «Сбер»): saved with the records. */
  newWallets: WalletRow[];
}

/** Record id of part `i` of a phrase: the first keeps the draft id (so a retry is still an upsert). */
export const partId = (draftId: string, i: number): string => (i === 0 ? draftId : `${draftId}-${i + 1}`);

/**
 * DECISIONS item 2: returning money that was only kept («чужие деньги») takes nothing from a wallet. So a «by_me»
 * return to someone whose held money is still with me (net balance of the person < 0) and no «I owe» debt gets no wallet;
 * once it was fully returned, later payments to him are ordinary.
 */
function returnsHeldMoney(result: ParseResult, records: RecordRow[]): boolean {
  if (result.kind !== 'repay' || result.fields.direction !== 'by_me' || !result.fields.who) return false;
  const key = personKey(result.fields.who);
  const mine = records.filter((r) => !r.deleted && personKey(r.fields.who) === key);
  const net = mine.reduce((sum, r) => sum + personDelta(r), 0); // < 0: his money is still with me
  return net < 0 && mine.some((r) => r.kind === 'held') && !mine.some((r) => r.kind === 'debt' && r.fields.direction === 'from_me');
}

/** Wallet order: named in the phrase > learned > last used > cash. For a transfer only the source gets a default. */
function buildOne(parsed: ParseResult, id: string, input: AutoInput, split: boolean): RecordRow {
  const { draft, wallets, lastWalletId, learned, now } = input;
  let result = applyLearned(parsed, learned, wallets);
  // «Маша должна мне 1500» moved no money: no wallet at all, not even a learned one.
  const walletless = (parsed.walletless && result.kind === parsed.kind) || returnsHeldMoney(result, input.records ?? []);
  if (walletless) result = { ...result, fields: { ...result.fields, wallet: undefined } };
  const state = stateFromParse(id, result, wallets);
  state.createdUtc = draft.created_utc;
  if (!walletless && KIND_FIELDS[result.kind].includes('wallet') && !state.walletId) {
    state.walletId = defaultWalletId(wallets, lastWalletId) ?? '';
    // «перевёл на золотую» while the last wallet IS the golden one: the money comes from cash (or the next wallet).
    if (state.walletId && state.walletId === state.toWalletId) {
      state.walletId = defaultWalletId(wallets.filter((w) => w.id !== state.toWalletId), null) ?? '';
    }
  }
  const record = recordFromState(state, now);
  // A part of a split phrase is never sent to the model: it would re-read the WHOLE phrase as one record.
  return needsModel(result) && !split ? { ...record, refine: 'pending' } : record;
}

/** Transfer targets the parser named that are no wallet yet (a known bank): new visible wallets, id from the draft. */
function walletsToCreate(parts: ParseResult[], wallets: WalletRow[], draftId: string): WalletRow[] {
  const names = [...new Set(parts.map((p) => (p.kind === 'transfer' ? p.fields.to_wallet : undefined)))];
  return names
    .filter((n): n is string => !!n && walletIdByName(wallets, n) === null)
    .map((name, i) => ({ id: `w-${draftId}${i === 0 ? '' : `-${i + 1}`}`, name, hidden: false, start_balance_minor: 0 }));
}

export function buildAutoRecords(input: AutoInput): AutoResults {
  const { draft, wallets } = input;
  const parts = parseMany(draft.text, new Date(draft.created_utc), walletRefs(wallets));
  const newWallets = walletsToCreate(parts, wallets, draft.id);
  const all = { ...input, wallets: [...wallets, ...newWallets] };
  const records = parts.map((p, i) => buildOne(p, partId(draft.id, i), all, parts.length > 1));
  const named = parts.find((p) => KIND_FIELDS[p.kind].includes('wallet') && p.fields.wallet);
  return { records, namedWalletId: named ? walletIdByName(wallets, named.fields.wallet) : null, newWallets };
}

/** One record (the first part): kept for callers and tests that think in single phrases. */
export function buildAutoRecord(input: AutoInput): AutoResult {
  const { records, namedWalletId } = buildAutoRecords(input);
  return { record: records[0], namedWalletId };
}
