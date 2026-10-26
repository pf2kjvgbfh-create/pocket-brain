// Income: salary, «получил», «пришло», refunds, cashback, «продал», «сдал», side jobs. Needs an amount.
// «кинули / перевели / положил на тинькофф 700» is income only when a wallet is named after «на / в».
import { findAmount } from '../money';
import { findSpan, word } from '../text';
import { findWallets, firstWallet } from '../wallets';
import type { Rule } from '../types';

const MARKER_RE = word(
  'получил\\p{L}*|продал\\p{L}*|сдал(?:а|и)?|принес(?:ла|ли)?|подработк\\p{L}*|отдал\\p{L}*\\s+мне|зарплат\\p{L}*|пришл\\p{L}*|пришел|заработал\\p{L}*|вернул\\p{L}*|кэшб[эе]к\\p{L}*|кешб[эе]к\\p{L}*|аванс\\p{L}*|преми\\p{L}*|доход\\p{L}*',
);
const ONTO_WALLET_RE = word('(?:за|с)?кинул\\p{L}*|перевели|положил\\p{L}*');
const ONTO = new Set(['на', 'в', 'во']);
// What the money was, in the dictionary form, for the toast and the list («Доход: зарплата — 120 000 ₽»).
const TITLES: [RegExp, string][] = [
  [word('зарплат\\p{L}*|зп'), 'зарплата'],
  [word('аванс\\p{L}*'), 'аванс'],
  [word('преми\\p{L}*'), 'премия'],
  [word('кэшб[эе]к\\p{L}*|кешб[эе]к\\p{L}*'), 'кэшбэк'],
  [word('подработк\\p{L}*'), 'подработка'],
];
const titleOf = (lower: string): string | undefined => TITLES.find(([re]) => findSpan(lower, re))?.[1];

export const incomeRule: Rule = (ctx) => {
  const wallets = findWallets(ctx.lower, ctx.wallets);
  const onto = findSpan(ctx.lower, ONTO_WALLET_RE) !== null && wallets.some((w) => ONTO.has(w.prep));
  if (!onto && !findSpan(ctx.lower, MARKER_RE)) return null;
  const amount = findAmount(ctx.lower);
  if (!amount) return null;
  return {
    kind: 'income',
    confidence: 0.9,
    fields: { title: titleOf(ctx.lower), amount_minor: amount.minor, wallet: (onto ? wallets.find((w) => ONTO.has(w.prep)) : firstWallet(wallets))?.name },
  };
};
