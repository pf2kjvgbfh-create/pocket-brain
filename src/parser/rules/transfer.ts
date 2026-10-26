// Transfers between own wallets: a transfer verb and two different wallets.
// «с/со/из X» is the source, «на/в Y» the target (prepositions, not word order).
// «снял 5000 с золотой» = from that wallet to cash. A phrase about a deposit («на вклад») is never a transfer.
// «перевёл 10к на сбер»: only the target is named → the source is left empty (autosave puts the last wallet there);
// a known bank with no wallet yet («Сбер») is a target too, autosave creates its wallet.
import { KNOWN_BANKS, type WalletRef } from '../../config';
import { findAmount } from '../money';
import { fold } from '../normalize';
import { findSpan, word } from '../text';
import { findWallets } from '../wallets';
import type { Rule } from '../types';

const VERB_RE = word('перевел\\p{L}*|перевела|перекинул\\p{L}*|переложил\\p{L}*|скинул\\p{L}*|положил\\p{L}*');
const CASH_OUT_RE = word('снял[аи]?');
// «перевели на золотую» / «положил на серебряную» are income (someone paid me): a target-only transfer needs «I moved».
const I_MOVED_RE = word('перевел|перевела|перекинул[а]?|скинул[а]?');
const DEPOSIT_RE = word('вклад\\p{L}*|накопительн\\p{L}*');
const FROM = new Set(['с', 'со', 'из']);
const TO = new Set(['на', 'в', 'во']);

/** The cash wallet: its name or an alias starts with «наличн». */
function cashWallet(wallets: WalletRef[]): WalletRef | undefined {
  return wallets.find((w) => [w.name, ...(w.aliases ?? [])].some((a) => fold(a).startsWith('наличн')));
}

export const transferRule: Rule = (ctx) => {
  const cashOut = findSpan(ctx.lower, CASH_OUT_RE) !== null;
  if (!cashOut && !findSpan(ctx.lower, VERB_RE)) return null;
  if (findSpan(ctx.lower, DEPOSIT_RE)) return null;
  const own = findWallets(ctx.lower, ctx.wallets);
  const banks = findWallets(ctx.lower, KNOWN_BANKS).filter((b) => !own.some((h) => h.start < b.end && b.start < h.end));
  const hits = [...own, ...banks].sort((a, b) => a.start - b.start);
  const onlyTarget = !cashOut && hits.length > 0 && hits.every((h) => TO.has(h.prep)) && findSpan(ctx.lower, I_MOVED_RE) !== null;
  if (onlyTarget) {
    const amount = findAmount(ctx.lower);
    return { kind: 'transfer', confidence: amount ? 0.9 : 0.6, fields: { amount_minor: amount?.minor, to_wallet: hits[0].name } };
  }
  if (banks.length > 0 && own.length === 0) return null;
  const from = hits.find((h) => FROM.has(h.prep)) ?? (cashOut ? undefined : hits[0]);
  if (!from) return null;
  const others = hits.filter((h) => h.name !== from.name);
  const cash = cashOut ? cashWallet(ctx.wallets)?.name : undefined;
  const to = others.find((h) => TO.has(h.prep))?.name ?? others[0]?.name ?? (cash !== from.name ? cash : undefined);
  if (!to) return null;
  const amount = findAmount(ctx.lower);
  return {
    kind: 'transfer',
    confidence: amount ? 0.9 : 0.6,
    fields: { amount_minor: amount?.minor, wallet: from.name, to_wallet: to },
  };
};
