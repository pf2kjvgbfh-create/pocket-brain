// Transfers between own wallets: a transfer verb and two different wallets.
// «с/со/из X» is the source, «на/в Y» the target (prepositions, not word order).
import { findAmount } from '../money';
import { findSpan, word } from '../text';
import { findWallets } from '../wallets';
import type { Rule } from '../types';

const VERB_RE = word('перевел\\p{L}*|перевела|перекинул\\p{L}*|переложил\\p{L}*|скинул\\p{L}*');
const FROM = new Set(['с', 'со', 'из']);
const TO = new Set(['на', 'в', 'во']);

export const transferRule: Rule = (ctx) => {
  if (!findSpan(ctx.lower, VERB_RE)) return null;
  const hits = findWallets(ctx.lower, ctx.wallets);
  const from = hits.find((h) => FROM.has(h.prep)) ?? hits[0];
  if (!from) return null;
  const others = hits.filter((h) => h.name !== from.name);
  const to = others.find((h) => TO.has(h.prep)) ?? others[0];
  if (!to) return null;
  const amount = findAmount(ctx.lower);
  return {
    kind: 'transfer',
    confidence: amount ? 0.9 : 0.6,
    fields: { amount_minor: amount?.minor, wallet: from.name, to_wallet: to.name },
  };
};
