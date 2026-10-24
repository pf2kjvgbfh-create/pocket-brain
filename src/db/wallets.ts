// Wallet list for the parser: visible AND hidden wallets with their CURRENT names + spoken aliases.
import { DEFAULT_WALLETS, type WalletRef } from '../config';
import type { WalletRow } from './types';

const defaultsById = new Map(DEFAULT_WALLETS.map((w) => [w.id, w]));

/**
 * A default wallet keeps its spoken aliases by id, even when renamed; its new name is added as an alias too.
 * A custom wallet has no aliases: the parser matches its name.
 */
export function walletRefs(wallets: WalletRow[]): WalletRef[] {
  return wallets.map((w) => {
    const def = defaultsById.get(w.id);
    if (!def) return { name: w.name };
    const aliases = [...(def.aliases ?? [])];
    if (w.name !== def.name) aliases.push(w.name.toLowerCase());
    return { name: w.name, aliases };
  });
}

/** Case-insensitive, trimmed name comparison for the "no duplicate names" rule. */
export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Wallet id by its current name (the parser returns names). */
export function walletIdByName(wallets: WalletRow[], name: string | undefined): string | null {
  if (!name) return null;
  return wallets.find((w) => w.name === name)?.id ?? null;
}

export type WalletNameCheck = { ok: true; name: string } | { ok: false; reason: string };

/** Validate a new or renamed wallet name: not empty, not used by another wallet. */
export function checkWalletName(wallets: WalletRow[], name: string, selfId?: string): WalletNameCheck {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, reason: 'Введи название' };
  if (wallets.some((w) => w.id !== selfId && sameName(w.name, trimmed))) {
    return { ok: false, reason: 'Такой кошелёк уже есть' };
  }
  return { ok: true, name: trimmed };
}

/** Default wallets first (in the config order), then the others by name. */
export function sortWallets(wallets: WalletRow[]): WalletRow[] {
  const order = new Map(DEFAULT_WALLETS.map((w, i) => [w.id, i]));
  return [...wallets].sort((a, b) => {
    const ia = order.get(a.id) ?? Infinity;
    const ib = order.get(b.id) ?? Infinity;
    return ia !== ib ? ia - ib : a.name.localeCompare(b.name, 'ru');
  });
}
