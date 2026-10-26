// Subscriptions / monthly payments: «подписка», «каждый месяц», «ежемесячно», «каждое 5 число».
// day = day of month; due_utc = next occurrence at the said time or 12:00 MSK.
import { findAmount } from '../money';
import { cutTitle, word } from '../text';
import { findClock, findDayOfMonth, nextDayOfMonth } from '../time';
import { findWallets, firstWallet } from '../wallets';
import type { Rule, Span } from '../types';

// «каждое 5 число» / «каждое 5-го число» (from «пятое») / «каждое 15-е число».
const MARKER_RE = word(
  'подписк\\p{L}*|кажд\\p{L}*\\s+месяц\\p{L}*|ежемесячн\\p{L}*|в\\s+месяц|кажд\\p{L}*\\s+\\d{1,2}(?:-?е|-го)?\\s+числ\\p{L}*',
  'gu',
);
const TITLE_STOP = ['оплата', 'платеж', 'платежи'];

export const subscriptionRule: Rule = (ctx) => {
  const markers: Span[] = [...ctx.lower.matchAll(MARKER_RE)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  if (markers.length === 0) return null;
  const amount = findAmount(ctx.lower);
  const day = findDayOfMonth(ctx.lower);
  const clock = findClock(ctx.lower);
  const wallets = findWallets(ctx.lower, ctx.wallets);
  const cut: Span[] = [...markers, ...wallets];
  if (amount) cut.push(amount);
  if (day) cut.push(day);
  if (clock) cut.push(clock);
  return {
    kind: 'subscription',
    confidence: amount ? 0.9 : 0.6,
    fields: {
      title: cutTitle(ctx.norm, cut, TITLE_STOP),
      amount_minor: amount?.minor,
      day: day?.day,
      due_utc: day ? nextDayOfMonth(day.day, ctx.now, clock?.hh, clock?.mm) : undefined,
      wallet: firstWallet(wallets)?.name,
    },
  };
};
