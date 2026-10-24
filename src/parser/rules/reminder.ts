// Reminders: «напомни …» with a time, or (implicit) an exact clock time / «через N минут» with no money.
import { findAmount } from '../money';
import { cutTitle, findSpan, word } from '../text';
import { findClock, findDayOfMonth, findTimes, nextDayOfMonth } from '../time';
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
