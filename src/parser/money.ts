// Amounts (→ integer kopecks), interest rates (%) and terms (months). Works on the folded, normalized text.
import type { Span } from './types';

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

/** Spans that contain numbers which are NOT money: clock times, relative times, day of month, hours of day. */
const NOT_MONEY_RES: RegExp[] = [
  new RegExp(`${B}\\d{1,2}:\\d{2}${E}`, 'gu'),
  new RegExp(`${B}через\\s+\\d+(?:[.,]\\d+)?\\s+\\p{L}+`, 'gu'),
  new RegExp(`${B}\\d{1,2}(?:\\s*-?\\s*(?:ого|го)|\\s+числа)${E}`, 'gu'),
  new RegExp(`${B}в\\s+\\d{1,2}\\s+(?:утра|вечера|дня|ночи)${E}`, 'gu'),
];

const AMOUNT_RE = new RegExp(`(?<![\\p{L}\\d.,])${NUM}(?:\\s*(руб\\p{L}*|р\\.|р${E}|₽))?`, 'gu');

export interface FoundAmount extends Span {
  minor: number;
  hasCurrency: boolean;
}

function mask(text: string, spans: Span[]): string {
  let out = text;
  for (const s of spans) out = out.slice(0, s.start) + ' '.repeat(s.end - s.start) + out.slice(s.end);
  return out;
}

/** The money amount: the first number with a currency word, otherwise the first number left
 *  after rates, terms, times and days are masked out. */
export function findAmount(lower: string): FoundAmount | null {
  const skip: Span[] = [];
  const rate = findRate(lower);
  if (rate) skip.push(rate);
  const term = findTerm(lower);
  if (term) skip.push(term);
  for (const re of NOT_MONEY_RES) {
    for (const m of lower.matchAll(re)) skip.push({ start: m.index, end: m.index + m[0].length });
  }
  const masked = mask(lower, skip);
  let first: FoundAmount | null = null;
  for (const m of masked.matchAll(AMOUNT_RE)) {
    const found: FoundAmount = {
      minor: Math.round(toNumber(m[1]) * 100),
      hasCurrency: m[2] !== undefined,
      start: m.index,
      end: m.index + m[0].length,
    };
    if (found.hasCurrency) return found;
    first ??= found;
  }
  return first;
}
