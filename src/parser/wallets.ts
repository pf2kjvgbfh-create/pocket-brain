// Wallet mentions: alias stems from config (or the wallet's own name) → canonical wallet name.
import type { WalletRef } from '../config';
import { fold } from './normalize';
import type { Span } from './types';

export interface WalletHit extends Span {
  name: string;
  /** Preposition right before the mention («с», «на», «в», …), '' if none. */
  prep: string;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function aliasesOf(w: WalletRef): string[] {
  const list = w.aliases && w.aliases.length > 0 ? w.aliases : [w.name];
  return list.map(fold);
}

const PREP_RE = /(?:^|[^\p{L}])(с|со|из|на|в|во)\s+$/u;

/** All wallet mentions, ordered by position. A mention may include a following «карта/картой/…». */
export function findWallets(lower: string, wallets: WalletRef[]): WalletHit[] {
  const hits: WalletHit[] = [];
  for (const w of wallets) {
    const alt = aliasesOf(w).map(escapeRe).join('|');
    const re = new RegExp(`(?<![\\p{L}\\d])(?:${alt})[\\p{L}-]*(?:\\s+карт\\p{L}*)?`, 'gu');
    for (const m of lower.matchAll(re)) {
      const prep = PREP_RE.exec(lower.slice(0, m.index))?.[1] ?? '';
      hits.push({ name: w.name, prep, start: m.index, end: m.index + m[0].length });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

const overlaps = (a: Span, b: Span): boolean => a.start < b.end && b.start < a.end;

/** First wallet mention that does not overlap any of the excluded spans. */
export function firstWallet(hits: WalletHit[], exclude: Span[] = []): WalletHit | undefined {
  return hits.find((h) => !exclude.some((x) => overlaps(h, x)));
}
