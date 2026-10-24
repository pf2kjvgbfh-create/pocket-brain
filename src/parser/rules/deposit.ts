// Deposits: «вклад» (opened / topped up), amount, rate and term.
// The source wallet is any wallet mention other than the «вклад» word itself.
import { findAmount, findRate, findTerm } from '../money';
import { word } from '../text';
import { findWallets, firstWallet } from '../wallets';
import type { Rule, Span } from '../types';

const MARKER_RE = word('вклад\\p{L}*', 'gu');

export const depositRule: Rule = (ctx) => {
  const markers: Span[] = [...ctx.lower.matchAll(MARKER_RE)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  if (markers.length === 0) return null;
  const amount = findAmount(ctx.lower);
  return {
    kind: 'deposit',
    confidence: amount ? 0.9 : 0.6,
    fields: {
      amount_minor: amount?.minor,
      rate: findRate(ctx.lower)?.value,
      term_months: findTerm(ctx.lower)?.value,
      wallet: firstWallet(findWallets(ctx.lower, ctx.wallets), markers)?.name,
    },
  };
};
