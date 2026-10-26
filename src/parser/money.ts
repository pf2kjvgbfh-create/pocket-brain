// Amounts (→ integer kopecks), interest rates (%) and terms (months). Works on the folded, normalized text.
import type { Currency, Span } from './types';

const B = '(?<![\\p{L}\\d])';
const E = '(?![\\p{L}\\d])';
const NUM = '(\\d+(?:[.,]\\d+)?)';

const toNumber = (s: string): number => Number(s.replace(',', '.'));

export interface FoundValue extends Span {
  value: number;
}

const RATE_RE = new RegExp(`(?:${B}под\\s+)?${B}${NUM}\\s*(?:%|процент\\p{L}*${E})`, 'u');

/** «под 6,5%», «6,5 процента» → 6.5 */
export function findRate(lower: string): FoundValue | null {
  const m = RATE_RE.exec(lower);
  return m ? { value: toNumber(m[1]), start: m.index, end: m.index + m[0].length } : null;
}

const TERM_RE = new RegExp(
  `${B}на\\s+(?:полгода|(?:(\\d+)\\s+)?(месяц\\p{L}*|мес\\.?|год\\p{L}*|лет)${E})`,
  'u',
);

/** «на 6 месяцев» → 6, «на год» → 12, «на полгода» → 6, «на 2 года» → 24 */
export function findTerm(lower: string): FoundValue | null {
  const m = TERM_RE.exec(lower);
  if (!m) return null;
  const span = { start: m.index, end: m.index + m[0].length };
  if (!m[2]) return { value: 6, ...span };
  const n = m[1] ? Number(m[1]) : 1;
  const months = m[2].startsWith('мес') ? n : n * 12;
  return { value: months, ...span };
}

const MONTHS = 'январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр';

/** Spans that contain numbers which are NOT money: clock times, relative times, day of month, hours of day, dates. */
const NOT_MONEY_RES: RegExp[] = [
  new RegExp(`${B}\\d{1,2}:\\d{2}${E}`, 'gu'),
  new RegExp(`${B}через\\s+\\d+(?:[.,]\\d+)?\\s+\\p{L}+`, 'gu'),
  new RegExp(`${B}\\d{1,2}(?:\\s*-?\\s*(?:ого|го)|\\s+числ\\p{L}*|-?е\\s+числ\\p{L}*)${E}`, 'gu'),
  new RegExp(`${B}(?:в\\s+)?\\d{1,2}(?:\\s+час(?:а|ов)?)?\\s+(?:утра|вечера|дня|ночи)${E}`, 'gu'),
  new RegExp(`${B}\\d{1,2}\\s+час(?:а|ов)?${E}`, 'gu'),
  new RegExp(`${B}\\d{1,2}\\s+(?:${MONTHS})\\p{L}*`, 'gu'),
];

// A currency word may follow the number; rubles may be followed by kopecks («89 рублей 50 копеек»).
const CURRENCY = `руб\\p{L}*|р\\.|р${E}|₽|доллар\\p{L}*|бакс\\p{L}*|\\$|евро${E}|€`;
const AMOUNT_RE = new RegExp(
  `(?<![\\p{L}\\d.,])${NUM}(?:\\s*(${CURRENCY})(?:\\s+(\\d{1,2})\\s+коп\\p{L}*)?)?`,
  'gu',
);

export interface FoundAmount extends Span {
  minor: number;
  hasCurrency: boolean;
  /** Dollars / euros; rubles have none. */
  currency?: Currency;
}

function currencyOf(word: string): Currency | undefined {
  if (/^(?:доллар|бакс|\$)/u.test(word)) return 'USD';
  if (/^(?:евро|€)/u.test(word)) return 'EUR';
  return undefined;
}

function mask(text: string, spans: Span[]): string {
  let out = text;
  for (const s of spans) out = out.slice(0, s.start) + ' '.repeat(s.end - s.start) + out.slice(s.end);
  return out;
}

/** Every number that can be money, in text order, after rates, terms, times, days and dates are masked out. */
export function findAmounts(lower: string): FoundAmount[] {
  const skip: Span[] = [];
  const rate = findRate(lower);
  if (rate) skip.push(rate);
  const term = findTerm(lower);
  if (term) skip.push(term);
  for (const re of NOT_MONEY_RES) {
    for (const m of lower.matchAll(re)) skip.push({ start: m.index, end: m.index + m[0].length });
  }
  const masked = mask(lower, skip);
  return [...masked.matchAll(AMOUNT_RE)].map((m) => ({
    minor: Math.round(toNumber(m[1]) * 100) + (m[3] ? Number(m[3]) : 0),
    hasCurrency: m[2] !== undefined,
    currency: m[2] ? currencyOf(m[2]) : undefined,
    start: m.index,
    end: m.index + m[0].length,
  }));
}

// «2 пиццы»: a number with a noun right after it (not a preposition) counts things; «за 1200» later is the price.
const COUNTED_RE = /^\s+(?!(?:за|на|в|во|с|со|из|по|и|а|от|до|у)(?![\p{L}\d]))\p{L}/u;
const PRICE_BEFORE_RE = /(?<![\p{L}\d])за\s+$/u;

/**
 * The money amount: the first number with a currency word, otherwise «за N» after a counted «2 пиццы», otherwise
 * the first number.
 */
export function findAmount(lower: string): FoundAmount | null {
  const all = findAmounts(lower);
  const withCurrency = all.find((a) => a.hasCurrency);
  if (withCurrency) return withCurrency;
  const [first] = all;
  if (first && COUNTED_RE.test(lower.slice(first.end))) {
    const price = all.find((a) => a !== first && PRICE_BEFORE_RE.test(lower.slice(0, a.start)));
    if (price) return price;
  }
  return first ?? null;
}
