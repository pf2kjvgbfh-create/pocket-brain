// The editable card as plain data: parser result / saved record <-> form state <-> record. No DOM here.
import { formatMoney, minorToInput, parseRubles } from '../money/format';
import type { ParseResult } from '../parser/types';
import { nextDayOfMonth } from '../parser/time';
import { fromMskInput, mskClock, mskDayLabel, toMskInput } from '../time/format';
import { walletIdByName } from '../db/wallets';
import type { Currency, Direction, Kind, RecordFields, RecordRow, WalletRow } from '../db/types';

export const KIND_LABEL: Record<Kind, string> = {
  reminder: 'Напоминание',
  expense: 'Расход',
  income: 'Доход',
  transfer: 'Перевод',
  held: 'Чужие деньги',
  deposit: 'Вклад',
  subscription: 'Подписка',
  debt: 'Долг',
  repay: 'Возврат долга',
  idea: 'Мысль',
};

export const KINDS = Object.keys(KIND_LABEL) as Kind[];

export type FieldName = 'title' | 'amount' | 'wallet' | 'toWallet' | 'due' | 'who' | 'direction' | 'rate' | 'term' | 'day' | 'tags';

/** Which inputs the card shows for each kind (the rest are not saved for that kind). */
export const KIND_FIELDS: Record<Kind, FieldName[]> = {
  reminder: ['title', 'due', 'tags'],
  expense: ['title', 'amount', 'wallet', 'tags'],
  income: ['title', 'amount', 'wallet', 'tags'],
  transfer: ['amount', 'wallet', 'toWallet', 'title', 'tags'],
  held: ['who', 'amount', 'rate', 'term', 'wallet', 'title', 'tags'],
  deposit: ['amount', 'rate', 'term', 'wallet', 'title', 'tags'],
  subscription: ['title', 'amount', 'day', 'wallet', 'tags'],
  debt: ['who', 'amount', 'direction', 'wallet', 'title', 'tags'],
  repay: ['who', 'amount', 'direction', 'wallet', 'title', 'tags'],
  idea: ['title', 'tags'],
};

/** The direction choices of the card per kind (the first one is the default). */
export const DIRECTIONS: Partial<Record<Kind, { value: Direction; label: string }[]>> = {
  debt: [
    { value: 'to_me', label: 'Мне должны' },
    { value: 'from_me', label: 'Я должен' },
  ],
  repay: [
    { value: 'by_me', label: 'Я вернул' },
    { value: 'to_me', label: 'Мне вернули' },
  ],
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
  /** Debts / returns; '' = the kind's default. */
  direction: Direction | '';
  /** Kept as parsed / saved (the card has no input for these yet). */
  currency?: Currency;
  happenedUtc?: string;
  doneUtc?: string;
  /** «No hour was said»: true only while `due` still equals `noTimeDue` (an edited time clears it). */
  noTime?: boolean;
  noTimeDue?: string;
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
    direction: f.direction ?? '',
    currency: f.currency,
    happenedUtc: f.happened_utc,
    noTime: f.no_time,
    noTimeDue: f.no_time ? toMskInput(f.due_utc ?? null) : undefined,
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
    direction: f.direction ?? '',
    currency: f.currency,
    happenedUtc: f.happened_utc,
    doneUtc: f.done_utc,
    noTime: f.no_time,
    noTimeDue: f.no_time ? toMskInput(r.due_utc) : undefined,
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
  const directions = DIRECTIONS[s.kind];
  if (shown.has('direction') && directions) {
    fields.direction = directions.some((d) => d.value === s.direction) ? (s.direction as Direction) : directions[0].value;
  }
  if (shown.has('amount') && s.currency) fields.currency = s.currency;
  if (shown.has('amount') && s.kind !== 'subscription' && s.happenedUtc) fields.happened_utc = s.happenedUtc;
  if (s.kind === 'reminder' && s.noTime && s.due === s.noTimeDue) fields.no_time = true;
  if ((s.kind === 'reminder' || s.kind === 'subscription') && s.doneUtc) fields.done_utc = s.doneUtc;

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
  const money = (minor: number): string => formatMoney(minor, s.currency);
  const who = s.who.trim();
  let head = KIND_LABEL[s.kind].toLowerCase();
  const parts: string[] = [];
  switch (s.kind) {
    case 'reminder': {
      const due = fromMskInput(s.due);
      parts.push(due ? `${mskDayLabel(due, now)} ${mskClock(due)} МСК` : 'время не указано');
      break;
    }
    case 'transfer': {
      if (amount !== undefined) head += ` ${money(amount)}`;
      const to = walletName(wallets, s.toWalletId);
      if (wallet || to) parts.push(`${wallet || '?'} → ${to || '?'}`);
      break;
    }
    case 'debt':
    case 'repay': {
      const dir = DIRECTIONS[s.kind]?.find((d) => d.value === s.direction) ?? DIRECTIONS[s.kind]?.[0];
      if (dir) parts.push(who ? `${dir.label.toLowerCase()}: ${who}` : dir.label.toLowerCase());
      if (amount !== undefined) parts.push(money(amount));
      if (wallet) parts.push(wallet);
      break;
    }
    case 'held':
      if (who) parts.push(who);
      if (amount !== undefined) parts.push(money(amount));
      if (rate) parts.push(rate);
      break;
    case 'deposit':
      if (amount !== undefined) head += ` ${money(amount)}`;
      if (rate) parts.push(rate);
      if (s.term.trim()) parts.push(`${s.term.trim()} мес.`);
      break;
    case 'subscription':
      if (amount !== undefined) head += ` ${money(amount)}`;
      if (s.day.trim()) parts.push(`${s.day.trim()}-го числа каждого месяца`);
      if (wallet) parts.push(wallet);
      break;
    case 'idea':
      break;
    default:
      if (amount !== undefined) head += ` ${money(amount)}`;
      if (wallet) parts.push(wallet);
  }
  if (s.currency && amount !== undefined) parts.push('в рублях не считается');
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

/** Several amounts in one phrase: «Записал 2 записи: расход 300,00 ₽; расход 250,00 ₽». One record = savedSentence. */
export function savedManySentence(records: RecordRow[], wallets: WalletRow[], now: Date): string {
  if (records.length === 1) return savedSentence(records[0], wallets, now);
  const n = records.length;
  const word = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'записи' : 'записей';
  const list = records.map((r) => describeState(stateFromRecord(r), wallets, now)).join('; ');
  return `Записал ${n} ${word}: ${list}`;
}
