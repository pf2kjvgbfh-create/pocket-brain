// Expenses: an explicit spending verb with an amount, or (implicit, lower confidence) an amount with
// a currency word or a wallet («кофе 180 рублей наличка»), a short «what + amount» note («такси 650»), or an
// amount first and a few words («5000 бензин», «25000 за аренду»). The spending verb never ends up in the title.
import { findAmount } from '../money';
import { cutTitle, findSpan, oneWordNominative, word } from '../text';
import { findTimes } from '../time';
import { findWallets, firstWallet } from '../wallets';
import { findHour } from '../when';
import type { ParseContext, Rule, RuleMatch, Span } from '../types';

const VERB_RE = word('купил\\p{L}*|потратил\\p{L}*|заплатил\\p{L}*|оплатил\\p{L}*|расход\\p{L}*', 'gu');

/** Every spending verb in the text (cut from titles). */
export function verbSpans(lower: string): Span[] {
  return [...lower.matchAll(VERB_RE)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

function expense(ctx: ParseContext, explicit: boolean): RuleMatch | null {
  const amount = findAmount(ctx.lower);
  if (!amount) return null;
  const wallets = findWallets(ctx.lower, ctx.wallets);
  if (!explicit && !amount.hasCurrency && wallets.length === 0) return null;
  const hour = findHour(ctx.lower);
  const cut: Span[] = [amount, ...wallets, ...verbSpans(ctx.lower), ...(hour ? [hour] : [])];
  return {
    kind: 'expense',
    confidence: explicit ? 0.9 : 0.6,
    fields: {
      title: oneWordNominative(cutTitle(ctx.norm, cut)),
      amount_minor: amount.minor,
      wallet: firstWallet(wallets)?.name,
    },
  };
}

export const expenseExplicitRule: Rule = (ctx) => (verbSpans(ctx.lower).length > 0 ? expense(ctx, true) : null);
export const expenseImplicitRule: Rule = (ctx) => expense(ctx, false);

const WISH_RE = word('хочу|хотел\\p{L}*|хорошо\\s+бы|надо\\s+бы|интересно|мечта\\p{L}*|идея');

/** 1–3 words left after cutting the amount, else null. */
function shortTitle(ctx: ParseContext, amount: Span): string | null {
  const title = cutTitle(ctx.norm, [amount]);
  const words = title.split(' ').filter((w) => w.length > 0);
  return words.length === 0 || words.length > 3 ? null : title;
}

/** «такси 650», «обед в столовой 420», «продуктов на 3400»: 1–3 words, then the amount ends the note. */
export const expenseShortRule: Rule = (ctx) => {
  const amount = findAmount(ctx.lower);
  if (!amount || amount.minor <= 0) return null;
  if (ctx.lower.slice(amount.end).replace(/[\s.,!]+/g, '') !== '') return null;
  if (findSpan(ctx.lower, WISH_RE)) return null;
  const title = shortTitle(ctx, amount);
  return title ? { kind: 'expense', confidence: 0.6, fields: { title, amount_minor: amount.minor } } : null;
};

/** Words right after the amount that make it a count, not money («30 книг», «2 раза», «5 минут»). */
// Whole words only («3000 метро», «1500 часы», «5000 штраф», «700 гречка» are money): the endings are listed.
const UNIT_RE = new RegExp(
  '^\\s*(?:минут[аыуе]?|секунд[аыуе]?|час(?:а|ов|у|е)?|дн(?:я|ей|и|ю)|день|недел(?:ь|я|и|ю|е|ей)|месяц(?:а|ев|е)?|год(?:а|ов|у|е)?|лет|раз(?:а|ов)?|км|кг|гр|штук[аиу]?|шт|страниц[аыуе]?|книг[аиуе]?|человек(?:а)?|процент(?:а|ов)?|%|метр(?:а|ов|у|ы)?|литр(?:а|ов|ы)?|шаг(?:а|ов|и)?|круг(?:а|ов|и)?|отжиман\\p{L}*|приседан\\p{L}*|подтягиван\\p{L}*|повтор\\p{L}*|подход\\p{L}*|калори\\p{L}*|балл(?:а|ов|ы)?|очк(?:а|ов|о)|стакан(?:а|ов)?|чашк[аиуе]?|чашек|бутыл(?:ка|ки|ку|ок|ке)|яиц|яйц(?:а|о)?)(?![\\p{L}\\d])',
  'u',
);

/** «30 книг», «2 раза»: the number counts something, it is not money. */
export const isCount = (lower: string, amount: Span): boolean => UNIT_RE.test(lower.slice(amount.end));

/**
 * A leading number below this (kopecks) is more often a count («3 яблока», «30 книг»); from 50 ₽ on, «500 такси» /
 * «300 кофе» are expenses (spec: a bare amount + a noun). Counts above it are caught by `isCount` («50 отжиманий»).
 */
const LEAD_MIN_MINOR = 5_000;
// chrono misses «к пятнице»; any day word means a plan, not a purchase.
const DAY_WORD_RE = word('понедельник\\p{L}*|вторник\\p{L}*|сред[аеуы]|четверг\\p{L}*|пятниц\\p{L}*|суббот\\p{L}*|воскресень\\p{L}*|завтра|сегодня|послезавтра');

/**
 * «25000 за аренду», «5000 бензин», «5к такси»: the phrase starts with the amount (50 ₽ and more), then 1–3 words,
 * and names no day («5000 к пятнице» is not a purchase).
 */
export const expenseLeadRule: Rule = (ctx) => {
  const amount = findAmount(ctx.lower);
  if (!amount || amount.minor < LEAD_MIN_MINOR || ctx.lower.slice(0, amount.start).trim() !== '') return null;
  if (isCount(ctx.lower, amount) || findSpan(ctx.lower, WISH_RE)) return null;
  if (findSpan(ctx.lower, DAY_WORD_RE) || findTimes(ctx.norm, ctx.now).length > 0) return null;
  const title = shortTitle(ctx, amount);
  return title ? { kind: 'expense', confidence: 0.6, fields: { title, amount_minor: amount.minor } } : null;
};
