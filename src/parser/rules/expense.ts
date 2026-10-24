// Expenses: an explicit spending verb with an amount, or (implicit, lower confidence) an amount with
// a currency word or a wallet («кофе 180 рублей наличка»).
import { findAmount } from '../money';
import { cutTitle, findSpan, word } from '../text';
import { findWallets, firstWallet } from '../wallets';
import type { ParseContext, Rule, RuleMatch, Span } from '../types';

const VERB_RE = word('купил\\p{L}*|потратил\\p{L}*|заплатил\\p{L}*|оплатил\\p{L}*|расход\\p{L}*');

function expense(ctx: ParseContext, explicit: boolean): RuleMatch | null {
  const amount = findAmount(ctx.lower);
  if (!amount) return null;
  const wallets = findWallets(ctx.lower, ctx.wallets);
  if (!explicit && !amount.hasCurrency && wallets.length === 0) return null;
  const cut: Span[] = [amount, ...wallets];
  return {
    kind: 'expense',
    confidence: explicit ? 0.9 : 0.6,
    fields: {
      title: cutTitle(ctx.norm, cut),
      amount_minor: amount.minor,
      wallet: firstWallet(wallets)?.name,
    },
  };
}

export const expenseExplicitRule: Rule = (ctx) => (findSpan(ctx.lower, VERB_RE) ? expense(ctx, true) : null);
export const expenseImplicitRule: Rule = (ctx) => expense(ctx, false);
