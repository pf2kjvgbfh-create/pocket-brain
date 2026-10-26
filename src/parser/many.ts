// Several amounts in one expense phrase: «купил кофе за 300 и круассан за 250», «кофе 200, булочка 150 и сок 120».
// Split only when EVERY gap between two amounts has a separator («,» «;» «и»); otherwise it is one record.
import { findAmounts } from './money';
import { isCount, verbSpans } from './rules/expense';
import { cutTitle } from './text';
import { findWallets, firstWallet } from './wallets';
import type { Currency, ParseContext, Span } from './types';

const SEPARATOR_RE = /[,;]|(?<![\p{L}])и(?![\p{L}])/u;

// «в 2 магазинах», «из 3 банок»: a bare number right after these prepositions counts things, it is not money.
const COUNT_AFTER_PREP_RE = /(?<![\p{L}\d])(?:в|во|из)\s+$/u;

export interface ExpensePart {
  title: string;
  amount_minor: number;
  currency?: Currency;
  /** The segment's own wallet; none = the phrase's wallet. */
  wallet?: string;
}

const shift = (s: Span, by: number): Span => ({ start: s.start - by, end: s.end - by });

/** The parts, or [] when the phrase is one expense. */
export function splitExpenses(ctx: ParseContext): ExpensePart[] {
  const amounts = findAmounts(ctx.lower).filter((a) => a.hasCurrency || !COUNT_AFTER_PREP_RE.test(ctx.lower.slice(0, a.start)));
  if (amounts.length < 2 || amounts.some((a) => isCount(ctx.lower, a))) return [];
  const cuts: number[] = [];
  for (let i = 0; i + 1 < amounts.length; i += 1) {
    const gap = ctx.lower.slice(amounts[i].end, amounts[i + 1].start);
    const sep = SEPARATOR_RE.exec(gap);
    if (!sep) return [];
    cuts.push(amounts[i].end + sep.index + sep[0].length);
  }
  const bounds = [0, ...cuts, ctx.lower.length];
  return amounts.map((amount, i) => {
    const from = bounds[i];
    const norm = ctx.norm.slice(from, bounds[i + 1]);
    const lower = ctx.lower.slice(from, bounds[i + 1]);
    const wallets = findWallets(lower, ctx.wallets);
    const spans = [shift(amount, from), ...wallets, ...verbSpans(lower)];
    return {
      title: cutTitle(norm, spans),
      amount_minor: amount.minor,
      currency: amount.currency,
      wallet: firstWallet(wallets)?.name,
    };
  });
}
