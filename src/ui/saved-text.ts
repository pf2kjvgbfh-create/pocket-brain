// What the toast and «Последняя запись» say (stage 7, B1): WHAT was saved, in plain words. Pure: no DOM.
// Times go through formatMsk: the full MSK date (never just «завтра»), the device time only when the zone differs.
import { formatMoneyShort } from '../money/format';
import { depositEnd, subscriptionNextDue } from '../money/totals';
import type { RecordRow, WalletRow } from '../db/types';
import { formatMsk, type FormatOptions } from '../time/format';

/** `now` is required (the year check and the next payment); `deviceOffsetMin` only in tests. */
export type SayOptions = FormatOptions & { now: Date };

const SNIPPET = 40;

/** The rules found nothing and the phrase became a thought («что-то непонятное про вторник»). */
export const notUnderstood = (r: RecordRow): boolean => r.kind === 'idea' && r.refine === 'pending';

const walletName = (wallets: WalletRow[], id: string | null | undefined): string => wallets.find((w) => w.id === id)?.name ?? '';
const snippet = (s: string): string => (s.length > SNIPPET ? `${s.slice(0, SNIPPET)}…` : s);
const rate = (r: RecordRow): string => (r.fields.rate === undefined ? '' : `, ${String(r.fields.rate).replace('.', ',')}%`);

/** «23.10 19:00 МСК (время не названо; у тебя 12:00)». */
function whenText(r: RecordRow, opts: SayOptions): string {
  if (!r.due_utc) return 'время не указано';
  const t = formatMsk(r.due_utc, opts);
  const notes = [r.fields.no_time ? 'время не названо' : '', t.small ?? ''].filter(Boolean);
  return notes.length ? `${t.big} (${notes.join('; ')})` : t.big;
}

/** «27.10» (or «27.10.2027» in another year), MSK, without the hour. */
export const mskDate = (utcIso: string, opts: SayOptions): string => formatMsk(utcIso, opts).big.split(' ')[0];

/** «кофе — 300 ₽» (or just the title / the amount when one is missing). */
function whatAndHowMuch(title: string, r: RecordRow): string {
  const f = r.fields;
  return f.amount_minor === undefined ? title : `${title} — ${formatMoneyShort(f.amount_minor, f.currency)}`;
}

function moneyLine(r: RecordRow, wallets: WalletRow[], opts: SayOptions, title: string): string {
  const wallet = walletName(wallets, r.wallet_id);
  const day = r.fields.happened_utc ? ` (${mskDate(r.fields.happened_utc, opts)})` : '';
  return `${whatAndHowMuch(title, r)}${wallet ? `, ${wallet}` : ''}${day}`;
}

function personLine(r: RecordRow, wallets: WalletRow[], from: boolean): string {
  const wallet = walletName(wallets, r.wallet_id);
  return `${whatAndHowMuch(r.fields.who || 'кто-то', r)}${wallet ? `, ${from ? 'с' : 'на'} «${wallet}»` : ''}`;
}

function sentence(r: RecordRow, wallets: WalletRow[], opts: SayOptions): string {
  const f = r.fields;
  const money = f.amount_minor === undefined ? '' : formatMoneyShort(f.amount_minor, f.currency);
  switch (r.kind) {
    case 'reminder':
      return `Напомню: ${f.title || 'дело'} — ${whenText(r, opts)}`;
    case 'expense':
      return `Записал: ${moneyLine(r, wallets, opts, f.title || 'трата')}`;
    case 'income':
      return `Доход: ${moneyLine(r, wallets, opts, f.title || 'деньги')}`;
    case 'transfer':
      return `Перевод: ${money || 'сумма?'}, ${walletName(wallets, r.wallet_id) || '?'} → ${walletName(wallets, f.to_wallet_id) || '?'}`;
    case 'deposit': {
      const wallet = walletName(wallets, r.wallet_id);
      const end = depositEnd(r);
      return `Вклад: ${money || 'сумма?'}${wallet ? ` — с «${wallet}»` : ''}${rate(r)}${end ? `, до ${end}` : ''}`;
    }
    case 'held':
      return `Чужие деньги: ${whatAndHowMuch(f.who || 'кто-то', r)}${rate(r)}`;
    case 'subscription': {
      const next = subscriptionNextDue(f, r.due_utc, opts.now);
      const head = `Подписка: ${f.title || 'платёж'}${money ? ` — ${money} в месяц` : ''}`;
      return next ? `${head}, следующий платёж ${mskDate(next, opts)}` : head;
    }
    case 'debt':
      if (f.direction === 'from_me') return `${r.wallet_id ? 'Взял в долг' : 'Я должен'}: ${personLine(r, wallets, false)}`;
      return `${r.wallet_id ? 'Дал в долг' : 'Мне должны'}: ${personLine(r, wallets, true)}`;
    case 'repay':
      return f.direction === 'to_me' ? `Мне вернули: ${personLine(r, wallets, false)}` : `Вернул долг: ${personLine(r, wallets, true)}`;
    case 'idea':
      return `${notUnderstood(r) ? 'Не понял — записал в мысли' : 'Мысль'}: ${snippet(f.title || r.raw_text)}`;
  }
}

/** One record in one sentence: «Записал: продукты — 1 250 ₽, Наличные», «Напомню: … — 27.10 09:00 МСК». */
export function recordSentence(r: RecordRow, wallets: WalletRow[], opts: SayOptions): string {
  const text = sentence(r, wallets, opts);
  return r.fields.currency && r.fields.amount_minor !== undefined ? `${text} — в рублях не считается` : text;
}

function recordsWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'запись';
  return m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'записи' : 'записей';
}

/** Several records: «кофе — 300 ₽; круассан — 250 ₽ (Наличные)» (the shared wallet once, at the end). */
function compactList(records: RecordRow[], wallets: WalletRow[], opts: SayOptions): string {
  const plainSpend = records.every((r) => (r.kind === 'expense' || r.kind === 'income') && !r.fields.happened_utc && !r.fields.currency);
  const wallet = records[0].wallet_id;
  if (plainSpend && wallet && records.every((r) => r.wallet_id === wallet)) {
    return `${records.map((r) => whatAndHowMuch(r.fields.title || 'трата', r)).join('; ')} (${walletName(wallets, wallet)})`;
  }
  const short = (r: RecordRow): string =>
    r.kind === 'expense' ? moneyLine(r, wallets, opts, r.fields.title || 'трата') : recordSentence(r, wallets, opts);
  return records.map(short).join('; ');
}

/** The toast after a save: one record = its sentence; N records = «Записал N записей: …». */
export function savedText(records: RecordRow[], wallets: WalletRow[], opts: SayOptions): string {
  if (records.length === 1) return recordSentence(records[0], wallets, opts);
  return `Записал ${records.length} ${recordsWord(records.length)}: ${compactList(records, wallets, opts)}`;
}

/** The same opening of a link came back: nothing new was written. */
export function alreadyText(r: RecordRow, wallets: WalletRow[], opts: SayOptions): string {
  return `Уже записано, второй раз не сохраняю. ${recordSentence(r, wallets, opts)}`;
}
