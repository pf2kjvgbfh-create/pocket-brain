// Time parsing. Every time is interpreted in MSK (+03:00) regardless of the device zone,
// and returned as an ISO UTC string. Calendar math uses UTC getters on (instant + 3 h) only.
import * as ru from 'chrono-node/ru';
import { DEFAULT_HOUR_MSK, MSK_OFFSET_MIN } from '../config';
import type { Span } from './types';

const OFFSET_MS = MSK_OFFSET_MIN * 60_000;

export interface FoundTime extends Span {
  dueUtc: string;
  certainHour: boolean;
}

/** The same MSK calendar day as `instant`, at hh:mm MSK. */
export function atMskTime(instant: Date, hh: number, mm: number): Date {
  const msk = new Date(instant.getTime() + OFFSET_MS);
  return new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate(), hh, mm) - OFFSET_MS);
}

/** All chrono (ru) matches; a date without an hour gets DEFAULT_HOUR_MSK. */
/**
 * chrono reads a lone duration as «from now»: «ремонт часов» → in an hour, «5 минут славы» → in 5 minutes.
 * Without «через» it is not a time; «через час» keeps «через» in the match and passes.
 */
const BARE_DURATION_RE = /^(?:\d+\s+|пол)?(?:секунд|минут|час|недел|месяц|год|лет)\p{L}*$/iu;

export function findTimes(text: string, now: Date): FoundTime[] {
  const results = ru.parse(text, { instant: now, timezone: MSK_OFFSET_MIN }, { forwardDate: true }).filter((r) => !BARE_DURATION_RE.test(r.text));
  return results.map((r) => {
    const certainHour = r.start.isCertain('hour');
    const date = certainHour ? r.start.date() : atMskTime(r.start.date(), DEFAULT_HOUR_MSK, 0);
    return { start: r.index, end: r.index + r.text.length, dueUtc: date.toISOString(), certainHour };
  });
}

const B = '(?<![\\p{L}\\d])';
const E = '(?![\\p{L}\\d])';
// «17-го (числа)», «17 числа», «5 число», «15-е число»; not «половину 5-го» (that is 4:30).
const DAY_RE = new RegExp(
  `(?<!половин\\p{L}*\\s+)${B}(\\d{1,2})(?:\\s*-?\\s*(?:ого|го)(?:\\s+числ\\p{L}*)?|\\s+числ\\p{L}*|-?е\\s+числ\\p{L}*)${E}`,
  'u',
);
const CLOCK_RE = new RegExp(`${B}(?:в\\s+)?(\\d{1,2}):(\\d{2})${E}`, 'u');

export interface FoundDay extends Span {
  day: number;
}

/** «17-го», «17-го числа», «17 числа», «5 число» (after normalization «семнадцатого» / «пятое» is «17-го» / «5-го»). */
export function findDayOfMonth(lower: string): FoundDay | null {
  const m = DAY_RE.exec(lower);
  if (!m) return null;
  const day = Number(m[1]);
  if (day < 1 || day > 31) return null;
  return { day, start: m.index, end: m.index + m[0].length };
}

export interface FoundClock extends Span {
  hh: number;
  mm: number;
}

/** «в 10:00» / «10:00». */
export function findClock(lower: string): FoundClock | null {
  const m = CLOCK_RE.exec(lower);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return { hh, mm, start: m.index, end: m.index + m[0].length };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Next occurrence (strictly after `now`) of day-of-month `day` at hh:mm MSK; short months clamp to their last day. */
export function nextDayOfMonth(day: number, now: Date, hh = DEFAULT_HOUR_MSK, mm = 0): string {
  const msk = new Date(now.getTime() + OFFSET_MS);
  let year = msk.getUTCFullYear();
  let month = msk.getUTCMonth();
  for (let k = 0; k < 2; k += 1) {
    const d = Math.min(day, daysInMonth(year, month));
    const candidate = Date.UTC(year, month, d, hh, mm) - OFFSET_MS;
    if (candidate > now.getTime()) return new Date(candidate).toISOString();
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  // Unreachable: the following month always lies after `now`.
  throw new Error('nextDayOfMonth: no occurrence found');
}
