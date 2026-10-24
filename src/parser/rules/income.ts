// Income: salary, «получил», «пришло», refunds, cashback. Needs an amount.
import { findAmount } from '../money';
import { findSpan, word } from '../text';
import { findWallets, firstWallet } from '../wallets';
import type { Rule } from '../types';

const MARKER_RE = word(
  'получил\\p{L}*|отдал\\p{L}*\\s+мне|зарплат\\p{L}*|пришл\\p{L}*|пришел|заработал\\p{L}*|вернул\\p{L}*|кэшб[эе]к\\p{L}*|кешб[эе]к\\p{L}*|аванс\\p{L}*|преми\\p{L}*|доход\\p{L}*',
);

export const incomeRule: Rule = (ctx) => {
  if (!findSpan(ctx.lower, MARKER_RE)) return null;
  const amount = findAmount(ctx.lower);
  if (!amount) return null;
  return {
    kind: 'income',
    confidence: 0.9,
    fields: { amount_minor: amount.minor, wallet: firstWallet(findWallets(ctx.lower, ctx.wallets))?.name },
  };
};
