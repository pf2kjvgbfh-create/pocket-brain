// The editable card as plain data: parser result / saved record <-> form state <-> record. No DOM here.
import { formatRub, minorToInput, parseRubles } from '../money/format';
import type { ParseResult } from '../parser/types';
import { nextDayOfMonth } from '../parser/time';
import { fromMskInput, mskClock, mskDayLabel, toMskInput } from '../time/format';
import { walletIdByName } from '../db/wallets';
import type { Kind, RecordFields, RecordRow, WalletRow } from '../db/types';

export const KIND_LABEL: Record<Kind, string> = {
  reminder: 'Напоминание',
  expense: 'Расход',
  income: 'Доход',
  transfer: 'Перевод',
  held: 'Чужие деньги',
  deposit: 'Вклад',
  subscription: 'Подписка',
  idea: 'Мысль',
};

export const KINDS = Object.keys(KIND_LABEL) as Kind[];

export type FieldName = 'title' | 'amount' | 'wallet' | 'toWallet' | 'due' | 'who' | 'rate' | 'term' | 'day' | 'tags';

/** Which inputs the card shows for each kind (the rest are not saved for that kind). */
export const KIND_FIELDS: Record<Kind, FieldName[]> = {
  reminder: ['title', 'due', 'tags'],
  expense: ['title', 'amount', 'wallet', 'tags'],
  income: ['title', 'amount', 'wallet', 'tags'],
  transfer: ['amount', 'wallet', 'toWallet', 'title', 'tags'],
  held: ['who', 'amount', 'rate', 'term', 'wallet', 'title', 'tags'],
  deposit: ['amount', 'rate', 'term', 'wallet', 'title', 'tags'],
  subscription: ['title', 'amount', 'day', 'wallet', 'tags'],
  idea: ['title', 'tags'],
};

export interface CardState {
  /** Record id (= draft id for a new one). */
  id: string;
  rawText: string;
  kind: Kind;
  title: string;
  /** Rubles as typed: «1234,50». */
  amount: string;
  /** Wallet id, '' = none. */
  walletId: string;
  toWalletId: string;
  /** MSK, «2026-10-23T19:00», '' = none. */
  due: string;
  who: string;
  rate: string;
  term: string;
  day: string;
  /** Comma separated. */
  tags: string;
  /** Set when editing an existing record. */
  createdUtc?: string;
}

const joinTags = (tags: string[]): string => tags.join(', ');
const splitTags = (s: string): string[] => [...new Set(s.split(/[,;\s]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean))];
const numOrUndef = (s: string): number | undefined => {
  const n = Number(s.trim().replace(',', '.'));
  return s.trim() !== '' && Number.isFinite(n) ? n : undefined;
};
const intOrUndef = (s: string): number | undefined => {
  const n = numOrUndef(s);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
};

export function stateFromParse(id: string, p: ParseResult, wallets: WalletRow[]): CardState {
  const f = p.fields;
  return {
    id,
    rawText: p.raw_text,
    kind: p.kind,
    title: f.title ?? '',
    amount: minorToInput(f.amount_minor),
    walletId: walletIdByName(wallets, f.wallet) ?? '',
    toWalletId: walletIdByName(wallets, f.to_wallet) ?? '',
    due: toMskInput(f.due_utc ?? null),
    who: f.who ?? '',
    rate: f.rate === undefined ? '' : String(f.rate).replace('.', ','),
    term: f.term_months === undefined ? '' : String(f.term_months),
    day: f.day === undefined ? '' : String(f.day),
    tags: joinTags(p.tags),
  };
}

export function stateFromRecord(r: RecordRow): CardState {
  const f = r.fields;
  return {
    id: r.id,
    rawText: r.raw_text,
    kind: r.kind,
    title: f.title ?? '',
    amount: minorToInput(f.amount_minor),
    walletId: r.wallet_id ?? '',
    toWalletId: f.to_wallet_id ?? '',
    due: toMskInput(r.due_utc),
    who: f.who ?? '',
    rate: f.rate === undefined ? '' : String(f.rate).replace('.', ','),
    term: f.term_months === undefined ? '' : String(f.term_months),
    day: f.day === undefined ? '' : String(f.day),
    tags: joinTags(f.tags ?? []),
    createdUtc: r.created_utc,
  };
}

/** The record to store. Saving never fails: empty or odd fields are simply left out. */
export function recordFromState(s: CardState, now: Date): RecordRow {
  const shown = new Set(KIND_FIELDS[s.kind]);
  const fields: RecordFields = {};
  const title = s.title.trim();
  if (shown.has('title') && title) fields.title = title;
  const amount = parseRubles(s.amount);
  if (shown.has('amount') && amount !== undefined) fields.amount_minor = amount;
  if (shown.has('toWallet') && s.toWalletId) fields.to_wallet_id = s.toWalletId;
  if (shown.has('who') && s.who.trim()) fields.who = s.who.trim();
  const rate = numOrUndef(s.rate);
  if (shown.has('rate') && rate !== undefined) fields.rate = rate;
  const term = intOrUndef(s.term);
  if (shown.has('term') && term !== undefined) fields.term_months = term;
  const day = intOrUndef(s.day);
  if (shown.has('day') && day !== undefined && day >= 1 && day <= 31) fields.day = day;
  const tags = splitTags(s.tags);
  if (shown.has('tags') && tags.length > 0) fields.tags = tags;

  let due: string | null = null;
  if (s.kind === 'reminder') due = fromMskInput(s.due) ?? null;
  else if (s.kind === 'subscription' && fields.day) due = nextDayOfMonth(fields.day, now);

  const nowIso = now.toISOString();
  return {
    id: s.id,
    kind: s.kind,
    raw_text: s.rawText,
    fields,
    wallet_id: shown.has('wallet') && s.walletId ? s.walletId : null,
    due_utc: due,
    created_utc: s.createdUtc ?? nowIso,
    updated_utc: nowIso,
    deleted: false,
  };
}

function walletName(wallets: WalletRow[], id: string): string {
  return wallets.find((w) => w.id === id)?.name ?? '';
}

/** «напоминание, завтра 19:00 МСК» — built from the CURRENT card values, so it follows edits. */
function describeState(s: CardState, wallets: WalletRow[], now: Date): string {
  const amount = parseRubles(s.amount);
  const wallet = walletName(wallets, s.walletId);
  const rate = s.rate.trim() ? `${s.rate.trim()}%` : '';
  let head = KIND_LABEL[s.kind].toLowerCase();
  const parts: string[] = [];
  switch (s.kind) {
    case 'reminder': {
      const due = fromMskInput(s.due);
      parts.push(due ? `${mskDayLabel(due, now)} ${mskClock(due)} МСК` : 'время не указано');
      break;
    }
    case 'transfer': {
      if (amount !== undefined) head += ` ${formatRub(amount)}`;
      const to = walletName(wallets, s.toWalletId);
      if (wallet || to) parts.push(`${wallet || '?'} → ${to || '?'}`);
      break;
    }
    case 'held':
      if (s.who.trim()) parts.push(s.who.trim());
      if (amount !== undefined) parts.push(formatRub(amount));
      if (rate) parts.push(rate);
      break;
    case 'deposit':
      if (amount !== undefined) head += ` ${formatRub(amount)}`;
      if (rate) parts.push(rate);
      if (s.term.trim()) parts.push(`${s.term.trim()} мес.`);
      break;
    case 'subscription':
      if (amount !== undefined) head += ` ${formatRub(amount)}`;
      if (s.day.trim()) parts.push(`${s.day.trim()}-го числа каждого месяца`);
      if (wallet) parts.push(wallet);
      break;
    case 'idea':
      break;
    default:
      if (amount !== undefined) head += ` ${formatRub(amount)}`;
      if (wallet) parts.push(wallet);
  }
  return [head, ...parts].join(', ');
}

/** «Понял так: …» (the edit card). */
export function understoodSentence(s: CardState, wallets: WalletRow[], now: Date): string {
  return `Понял так: ${describeState(s, wallets, now)}`;
}

/** «Записал: расход 500,00 ₽, Золотая карта» (the toast after an autosave). */
export function savedSentence(r: RecordRow, wallets: WalletRow[], now: Date): string {
  return `Записал: ${describeState(stateFromRecord(r), wallets, now)}`;
}

/** The same phrase opened again: nothing new was written. */
export function alreadySentence(r: RecordRow, wallets: WalletRow[], now: Date): string {
  return `Уже записано: ${describeState(stateFromRecord(r), wallets, now)}`;
}
