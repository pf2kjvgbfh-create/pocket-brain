// Reminders: «напомни …» with a time, or (implicit) an exact clock time / «через N минут» with no money,
// or a part of the day («завтра днём», «вечером», «к девяти») with no money.
import { findAmount } from '../money';
import { cutTitle, findSpan, word } from '../text';
import { atMskTime, findClock, findDayOfMonth, findTimes, nextDayOfMonth } from '../time';
import type { ParseContext, Rule, RuleMatch, Span } from '../types';

const MARKER_RE = word('напомни(?:ть)?|напоминание|не\\s+забыть|не\\s+забудь');
const MARKER_TAIL_RE = /^\s+мне(?![\p{L}])/u;

interface Due {
  dueUtc: string;
  certainHour: boolean;
  spans: Span[];
}

/** Day of month («17-го числа», own regex: chrono does not know it) first, then chrono. */
function findDue(ctx: ParseContext): Due | null {
  const day = findDayOfMonth(ctx.lower);
  if (day) {
    const clock = findClock(ctx.lower);
    const dueUtc = nextDayOfMonth(day.day, ctx.now, clock?.hh, clock?.mm);
    return { dueUtc, certainHour: clock !== null, spans: clock ? [day, clock] : [day] };
  }
  const times = findTimes(ctx.norm, ctx.now);
  if (times.length === 0) return null;
  return { dueUtc: times[0].dueUtc, certainHour: times.some((t) => t.certainHour), spans: times };
}

function build(ctx: ParseContext, due: Due | null, marker: Span | null, confidence: number): RuleMatch {
  const spans = [...(due?.spans ?? []), ...(marker ? [marker] : [])];
  return { kind: 'reminder', confidence, fields: { title: cutTitle(ctx.norm, spans), due_utc: due?.dueUtc } };
}

/** «напомни(ть)» / «не забыть» anywhere → reminder (with or without a recognised time). */
export const reminderExplicitRule: Rule = (ctx) => {
  const found = findSpan(ctx.lower, MARKER_RE);
  if (!found) return null;
  const tail = MARKER_TAIL_RE.exec(ctx.lower.slice(found.end));
  const marker = tail ? { start: found.start, end: found.end + tail[0].length } : found;
  const due = findDue(ctx);
  return build(ctx, due, marker, due ? 0.9 : 0.6);
};

/** No marker: only an exact hour («в 15:30», «через 10 минут») and no money make a reminder.
 *  A bare weekday or date («про вторник») is not enough. */
export const reminderImplicitRule: Rule = (ctx) => {
  if (findAmount(ctx.lower)?.hasCurrency) return null;
  const due = findDue(ctx);
  if (!due || !due.certainHour) return null;
  return build(ctx, due, null, 0.75);
};

/** Hours (MSK) for a part of the day (the text is folded: «днём» → «днем»). */
const DAY_PART_HOURS: Record<string, number> = { утром: 9, днем: 13, вечером: 19 };
const DAY_PART_RE = word('утром|днем|вечером');
// «к девяти»: normalization does not turn these genitive hour words into digits.
const BY_HOUR_WORDS = ['одному', 'двум', 'трем', 'четырем', 'пяти', 'шести', 'семи', 'восьми', 'девяти', 'десяти', 'одиннадцати', 'двенадцати'];
const BY_HOUR_RE = word(`к\\s+(\\d{1,2}|${BY_HOUR_WORDS.join('|')})`);

/** «к девяти» → 9, «к трём» → 15 (1–6 are taken as afternoon), «к 10» → 10. */
function findByHour(lower: string): (Span & { hh: number }) | null {
  const m = BY_HOUR_RE.exec(lower);
  if (!m) return null;
  const n = /^\d/.test(m[1]) ? Number(m[1]) : BY_HOUR_WORDS.indexOf(m[1]) + 1;
  if (n < 1 || n > 23) return null;
  return { hh: n <= 6 ? n + 12 : n, start: m.index, end: m.index + m[0].length };
}

/** No marker, no money: a part of the day or «к N», with or without a day word → a reminder at that hour MSK.
 *  Without a day word it is today, or tomorrow when that hour has passed. */
export const reminderDayPartRule: Rule = (ctx) => {
  if (findAmount(ctx.lower)) return null;
  const part = findSpan(ctx.lower, DAY_PART_RE);
  const byHour = findByHour(ctx.lower);
  if (!part && !byHour) return null;
  const partWord = part ? ctx.lower.slice(part.start, part.end) : '';
  let hh = byHour ? byHour.hh : DAY_PART_HOURS[partWord];
  if (byHour && partWord === 'вечером' && hh < 12) hh += 12;
  const times = findTimes(ctx.norm, ctx.now);
  let due = atMskTime(times[0] ? new Date(times[0].dueUtc) : ctx.now, hh, 0);
  if (due.getTime() <= ctx.now.getTime()) {
    if (times[0]) return null; // «вчера вечером ходили в кино» is a past event, not a reminder
    due = new Date(due.getTime() + 86_400_000);
  }
  const spans: Span[] = [...times, ...(part ? [part] : []), ...(byHour ? [byHour] : [])];
  return { kind: 'reminder', confidence: 0.75, fields: { title: cutTitle(ctx.norm, spans), due_utc: due.toISOString() } };
};
