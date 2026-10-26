// «When» for reminders and past money: the hour of day is read by our own regexes («в 3 ночи», «в половину пятого»,
// «в 10 утра», «вечером»), chrono only gives the day. All in MSK: UTC getters on (instant + 3 h), never the device zone.
import { MSK_OFFSET_MIN } from '../config';
import { fold } from './normalize';
import { word } from './text';
import { atMskTime, findTimes } from './time';
import type { Span } from './types';

const DAY_MS = 86_400_000;
const B = '(?<![\\p{L}\\d])';
const E = '(?![\\p{L}\\d])';
const PART = '(?:\\s+(утра|ночи|дня|вечера))';
const HOURS = '(?:\\s+час(?:а|ов)?)';
// Words after a bare «в N» that make it a count, not an hour («в 2 раза», «в 3 магазина» stays an hour: rare).
const NOT_HOUR_AFTER = '(?!\\s*(?:руб|р\\.|₽|тыс|%|процент|раз|минут|секунд|дн|недел|месяц|год|лет|числ|-))';

const HALF_RE = new RegExp(`${B}(?:в\\s+)?половин[уаые]\\s+(\\d{1,2})-го${PART}?${E}`, 'u');
const CLOCK_RE = new RegExp(`${B}(?:в\\s+)?(\\d{1,2}):(\\d{2})${PART}?${E}`, 'u');
const AT_HOUR_RE = new RegExp(`${B}в\\s+(\\d{1,2})${HOURS}?${PART}?${E}${NOT_HOUR_AFTER}`, 'u');
const PART_HOUR_RE = new RegExp(`(?<!через\\s+)${B}(\\d{1,2})(?:${HOURS}?\\s+(утра|ночи|вечера)|${HOURS}\\s+(дня))${E}`, 'u');

export interface FoundHour extends Span {
  hh: number;
  mm: number;
}

/** «ночи / утра / дня / вечера» applied to an hour; without one, a spoken whole or half hour 1–7 is afternoon. */
function applyPart(hh: number, part: string | undefined, spokenHour: boolean): number {
  if (part === 'ночи') return hh === 12 ? 0 : hh >= 9 ? hh + 12 : hh;
  if (part === 'дня' || part === 'вечера') return hh < 12 ? hh + 12 : hh;
  if (part === 'утра') return hh === 12 ? 0 : hh;
  return spokenHour && hh >= 1 && hh <= 7 ? hh + 12 : hh;
}

function hourFrom(m: RegExpExecArray, hh: number, mm: number, part: string | undefined, spokenHour: boolean): FoundHour | null {
  const h = applyPart(hh, part, spokenHour);
  if (h > 23 || mm > 59) return null;
  return { hh: h, mm, start: m.index, end: m.index + m[0].length };
}

/**
 * The hour of day said in the (folded) text. «в половину пятого» = 4:30 → 16:30; «в 5» → 17:00 (1–7 without «утра»
 * or «ночи» is afternoon); a clock «в 2:15» is taken literally (an old rule: «в два пятнадцать» = 02:15).
 */
export function findHour(lower: string): FoundHour | null {
  let m = HALF_RE.exec(lower);
  if (m) {
    const n = Number(m[1]);
    return hourFrom(m, n === 1 ? 12 : n - 1, 30, m[2], true);
  }
  m = CLOCK_RE.exec(lower);
  if (m) return hourFrom(m, Number(m[1]), Number(m[2]), m[3], false);
  m = AT_HOUR_RE.exec(lower);
  if (m) return hourFrom(m, Number(m[1]), 0, m[2], true);
  m = PART_HOUR_RE.exec(lower);
  if (m) return hourFrom(m, Number(m[1]), 0, m[2] ?? m[3], false);
  return null;
}

/** Hours (MSK) for a part of the day (the text is folded: «днём» → «днем»). */
const DAY_PART_HOURS: Record<string, number> = { утром: 9, днем: 13, вечером: 19 };
const DAY_PART_RE = word('утром|днем|вечером');

export function findDayPart(lower: string): FoundHour | null {
  const m = DAY_PART_RE.exec(lower);
  return m ? { hh: DAY_PART_HOURS[m[0]], mm: 0, start: m.index, end: m.index + m[0].length } : null;
}

export interface FoundWhen {
  dueUtc: string;
  /** An hour of day or a relative time («через 10 минут») was said. A part of the day («утром») is not exact. */
  certainHour: boolean;
  /** No hour at all: 12:00 MSK of that day. */
  noTime: boolean;
  /** Everything that was read as time (cut from the title). */
  spans: Span[];
}

/** Same length, but not a run of spaces: chrono reads «28 марта» + many spaces as «марта» (the 1st). */
const filler = (n: number): string => (n < 3 ? ' '.repeat(n) : ` ${'_'.repeat(n - 2)} `);
const blank = (text: string, spans: Span[]): string =>
  spans.reduce((t, s) => t.slice(0, s.start) + filler(s.end - s.start) + t.slice(s.end), text);

const mskDay = (d: Date): number => Math.floor((d.getTime() + MSK_OFFSET_MIN * 60_000) / DAY_MS);

const WEEKDAY_RE = word('понедельник\\p{L}*|вторник\\p{L}*|сред[аеуы]|четверг\\p{L}*|пятниц\\p{L}*|суббот\\p{L}*|воскресень\\p{L}*');
const DATE_RE = /\d|январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр/u;

/** The hour has passed today: a named weekday → in a week, an explicit date → next year, «сегодня» / no day → tomorrow. */
function nextTime(due: Date, said: string): Date {
  const lower = fold(said);
  if (WEEKDAY_RE.test(lower)) return new Date(due.getTime() + 7 * DAY_MS);
  if (DATE_RE.test(lower)) {
    const next = new Date(due);
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    return next;
  }
  return new Date(due.getTime() + DAY_MS);
}

/**
 * The due time of a reminder. The hour (own regexes) is cut out before chrono reads the day, so chrono never
 * mistakes «3 часа» for a duration. An hour that has already passed today → `nextTime`.
 */
export function findWhen(norm: string, now: Date): FoundWhen | null {
  const lower = fold(norm);
  const exactHour = findHour(lower);
  const hour = exactHour ?? findDayPart(lower);
  const times = findTimes(blank(norm, hour ? [hour] : []), now);
  if (!hour) {
    if (times.length === 0) return null;
    return { dueUtc: times[0].dueUtc, certainHour: times.some((t) => t.certainHour), noTime: !times[0].certainHour, spans: times };
  }
  const base = times[0] ? new Date(times[0].dueUtc) : now;
  let due = atMskTime(base, hour.hh, hour.mm);
  if (due.getTime() <= now.getTime() && mskDay(base) === mskDay(now)) due = nextTime(due, times[0] ? norm.slice(times[0].start, times[0].end) : '');
  return { dueUtc: due.toISOString(), certainHour: exactHour !== null, noTime: false, spans: [...times, hour] };
}

const PAST_DAY_RE = word('позавчера|вчера');

export interface FoundHappened {
  utc: string;
  spans: Span[];
}

/** «вчера потратил 500» → yesterday (MSK) at the current MSK time, or at the hour said («вчера в 15:00»). */
export function findHappened(lower: string, now: Date): FoundHappened | null {
  const m = PAST_DAY_RE.exec(lower);
  if (!m) return null;
  const day = new Date(now.getTime() - (m[0] === 'позавчера' ? 2 : 1) * DAY_MS);
  const hour = findHour(lower);
  const utc = hour ? atMskTime(day, hour.hh, hour.mm) : day;
  return { utc: utc.toISOString(), spans: [{ start: m.index, end: m.index + m[0].length }, ...(hour ? [hour] : [])] };
}
