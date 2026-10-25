// Corrections memory (no AI): when the owner fixes a record's kind or wallet, its key words are remembered, and the
// next similar phrase gets the same kind / wallet. Pure functions; the store itself is the settings key `learned`.
import { DEFAULT_WALLETS, LEARNED_MAX } from '../config';
import type { RecordRow, WalletRow } from '../db/types';
import { walletRefs } from '../db/wallets';
import { KINDS } from '../ui/card-model';
import { parse } from './index';
import { findAmount } from './money';
import { fold, normalize } from './normalize';
import { cutTitle } from './text';
import type { Kind, ParseResult } from './types';

export interface LearnedEntry {
  /** The kind to use instead of what the rules said. */
  to_kind?: Kind;
  wallet_id?: string;
  updated_utc: string;
}

/** Key = `${stem}|${rulesKind}`: the key word and the kind the RULES gave (not the stored one). */
export type Learned = Record<string, LearnedEntry>;

/** Short function words; longer ones are matched by their beginning in STOP_PREFIX. */
const STOP_EXACT = new Set(['для', 'при', 'над', 'под', 'про', 'без', 'или', 'что', 'как', 'это', 'мне', 'мой', 'моя', 'его', 'она', 'они', 'все', 'так', 'уже', 'еще', 'тоже', 'надо', 'руб', 'тыс', 'млн']);

/** Verbs, money words, dates; wallet alias stems are added below. */
const STOP_PREFIX = [
  'купи', 'потрат', 'заплат', 'оплат', 'отдал', 'отдан', 'получ', 'пришл', 'пришё', 'перевел', 'перевёл', 'перевед', 'перекин', 'положи', 'открыл', 'открыт',
  'рубл', 'копе', 'тысяч', 'миллион', 'процент', 'напомн', 'завтра', 'послезавтр', 'сегодн', 'вчера', 'утром', 'вечером', 'кажд', 'ежемесяч', 'нужно', 'карт',
].map(fold);

const aliasStems = DEFAULT_WALLETS.flatMap((w) => (w.aliases ?? []).flatMap((a) => fold(a).split(/[^\p{L}]+/u).filter((p) => p.length >= 3)));
const STOP_STEMS = [...new Set([...STOP_PREFIX, ...aliasStems])];

const isStopword = (word: string): boolean => STOP_EXACT.has(word) || STOP_STEMS.some((s) => word.startsWith(s));

/** Key words of a phrase as stems (letters only, 3+ letters, no stopwords, number words are already digits). */
export function keywordStems(text: string): string[] {
  const words = fold(normalize(text)).match(/\p{L}+/gu) ?? [];
  const stems = words.filter((w) => w.length >= 3 && !isStopword(w)).map((w) => w.slice(0, Math.max(4, w.length - 2)));
  return [...new Set(stems)];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Drop the oldest entries above LEARNED_MAX. */
function cap(learned: Learned): Learned {
  const keys = Object.keys(learned);
  if (keys.length <= LEARNED_MAX) return learned;
  keys.sort((a, b) => (learned[a].updated_utc < learned[b].updated_utc ? 1 : learned[a].updated_utc > learned[b].updated_utc ? -1 : 0));
  return Object.fromEntries(keys.slice(0, LEARNED_MAX).map((k) => [k, learned[k]]));
}

/** The store from outside (a backup, a damaged value) is untrusted: keep only well-formed entries. */
export function sanitizeLearned(v: unknown): Learned {
  if (!isObj(v)) return {};
  const out: Learned = {};
  for (const [key, e] of Object.entries(v)) {
    if (!key.includes('|') || !isObj(e) || typeof e.updated_utc !== 'string') continue;
    const entry: LearnedEntry = { updated_utc: e.updated_utc };
    if (typeof e.to_kind === 'string' && (KINDS as string[]).includes(e.to_kind)) entry.to_kind = e.to_kind as Kind;
    if (typeof e.wallet_id === 'string') entry.wallet_id = e.wallet_id;
    if (entry.to_kind || entry.wallet_id) out[key] = entry;
  }
  return cap(out);
}

/** Two stores into one (a restore): per key the newest entry wins. */
export function mergeLearned(local: Learned, remote: Learned): Learned {
  const out: Learned = { ...local };
  for (const [key, e] of Object.entries(remote)) {
    if (!out[key] || e.updated_utc > out[key].updated_utc) out[key] = e;
  }
  return cap(out);
}

/**
 * The owner saved an edit: remember the final kind / wallet for the key words of the phrase.
 * Only when the kind or the wallet changed in THIS edit. The kind is stored whenever it differs from the rules;
 * the wallet only when it was changed now (otherwise the older learned wallet is kept).
 */
export function learnFromEdit(input: { before: RecordRow; after: RecordRow; learned: Learned; wallets: WalletRow[]; now: Date }): Learned {
  const { before, after, learned, wallets, now } = input;
  const walletChanged = before.wallet_id !== after.wallet_id;
  if (before.kind === after.kind && !walletChanged) return learned;
  const stems = keywordStems(before.raw_text);
  if (stems.length === 0) return learned;
  const rulesKind = parse(before.raw_text, new Date(before.created_utc), walletRefs(wallets)).kind;
  const toKind = after.kind !== rulesKind ? after.kind : undefined;
  const out: Learned = { ...learned };
  for (const stem of stems) {
    const key = `${stem}|${rulesKind}`;
    const walletId = walletChanged ? (after.wallet_id ?? undefined) : out[key]?.wallet_id;
    if (!toKind && !walletId) delete out[key];
    else out[key] = { ...(toKind ? { to_kind: toKind } : {}), ...(walletId ? { wallet_id: walletId } : {}), updated_utc: now.toISOString() };
  }
  return cap(out);
}

const MONEY_KINDS: readonly Kind[] = ['expense', 'income', 'transfer', 'held', 'deposit', 'subscription'];

/** A phrase the rules took for an idea, forced into a money kind: the amount (and a clean title) is still in the text. */
function reinterpret(result: ParseResult, kind: Kind): ParseResult {
  const fields = { ...result.fields };
  if (MONEY_KINDS.includes(kind) && fields.amount_minor === undefined) {
    const norm = normalize(result.raw_text);
    const amount = findAmount(fold(norm));
    if (amount) {
      fields.amount_minor = amount.minor;
      if (result.kind === 'idea') fields.title = cutTitle(norm, [amount]) || fields.title;
    }
  }
  return { ...result, kind, confidence: Math.max(result.confidence, 0.6), fields };
}

/** Newest matching entry per attribute. A wallet named in the phrase is never replaced. */
export function applyLearned(result: ParseResult, learned: Learned, wallets: WalletRow[]): ParseResult {
  let kindEntry: LearnedEntry | undefined;
  let walletEntry: LearnedEntry | undefined;
  for (const stem of keywordStems(result.raw_text)) {
    const e = learned[`${stem}|${result.kind}`];
    if (!e) continue;
    if (e.to_kind && (!kindEntry || e.updated_utc >= kindEntry.updated_utc)) kindEntry = e;
    if (e.wallet_id && (!walletEntry || e.updated_utc >= walletEntry.updated_utc)) walletEntry = e;
  }
  let out = result;
  if (kindEntry?.to_kind && kindEntry.to_kind !== result.kind) out = reinterpret(result, kindEntry.to_kind);
  if (walletEntry && out.fields.wallet === undefined) {
    const wallet = wallets.find((w) => w.id === walletEntry.wallet_id && !w.hidden);
    if (wallet) out = { ...out, fields: { ...out.fields, wallet: wallet.name } };
  }
  return out;
}
