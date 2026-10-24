// «Чужие деньги»: someone gave me money to keep, maybe at a rate. Needs an explicit keeping marker,
// so «Иван отдал мне долг» is not held money.
import { findAmount, findRate, findTerm } from '../money';
import { findSpan, word } from '../text';
import { findWallets, firstWallet } from '../wallets';
import type { ParseContext, Rule } from '../types';

const MARKER_RE = word('на\\s+хранени\\p{L}*|чуж\\p{L}*\\s+деньг\\p{L}*|оставил\\p{L}*\\s+у\\s+меня|подержать');
const GIVE_VERB_RE = /^(?:от|пере)?дал[аи]?$|^(?:оставил|положил|доверил|вручил)[аи]?$/u;
const NOT_A_NAME = new Set(['мне', 'я', 'мы', 'и', 'а', 'он', 'она', 'они', 'деньги', 'чужие']);

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Who gave the money: the word right before the giving verb, else the first capitalised word after the start. */
function findWho(ctx: ParseContext): string | undefined {
  const words = [...ctx.norm.matchAll(/[\p{L}-]+/gu)].map((m) => m[0]);
  const verb = words.findIndex((w) => GIVE_VERB_RE.test(w.toLowerCase()));
  if (verb > 0) {
    const before = words[verb - 1];
    if (!NOT_A_NAME.has(before.toLowerCase())) return capitalize(before);
  }
  return words.slice(1).find((w) => /^\p{Lu}/u.test(w) && !NOT_A_NAME.has(w.toLowerCase()));
}

export const heldRule: Rule = (ctx) => {
  if (!findSpan(ctx.lower, MARKER_RE)) return null;
  const amount = findAmount(ctx.lower);
  return {
    kind: 'held',
    confidence: amount ? 0.9 : 0.6,
    fields: {
      who: findWho(ctx),
      amount_minor: amount?.minor,
      rate: findRate(ctx.lower)?.value,
      term_months: findTerm(ctx.lower)?.value,
      wallet: firstWallet(findWallets(ctx.lower, ctx.wallets))?.name,
    },
  };
};
