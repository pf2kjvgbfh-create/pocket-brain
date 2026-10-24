// App-wide configurable values (invariant 8: defaults live here, not scattered in code).

export interface WalletRef {
  /** Canonical wallet name shown in the UI and returned by the parser. */
  name: string;
  /** Lower-case word stems that refer to this wallet in speech (matched at a word start). */
  aliases?: string[];
}

/** A default wallet also has a STABLE id, so a renamed wallet keeps its spoken aliases. */
export interface DefaultWallet extends WalletRef {
  id: string;
}

/** Default wallets with their spoken aliases (stems, so every case form matches). */
export const DEFAULT_WALLETS: DefaultWallet[] = [
  { id: 'cash', name: 'Наличные', aliases: ['наличн', 'наличк', 'налик'] },
  { id: 'deposit', name: 'Вклад', aliases: ['вклад'] },
  { id: 'gold', name: 'Золотая карта', aliases: ['золот'] },
  { id: 'silver', name: 'Серебряная карта', aliases: ['серебрян'] },
  { id: 'tinkoff', name: 'Тинькофф', aliases: ['тиньк', 'тиньков', 'т-банк', 'тбанк'] },
];

/** Moscow offset in minutes: every parsed time is interpreted in MSK regardless of the phone zone. */
export const MSK_OFFSET_MIN = 180;

/** Time used when a date is said without an hour (MSK). */
export const DEFAULT_HOUR_MSK = 12;

/** Shown on the settings screen. */
export const APP_VERSION = '0.2.0';

/** A record with the same raw text saved within this window counts as "already saved" (opening one link twice). */
export const DUPLICATE_WINDOW_MIN = 10;

/** How many latest operations the money screen lists. */
export const RECENT_OPERATIONS = 15;

/** Name of the iPhone Shortcut the owner builds by hand (SETUP section 4). Never rename without updating SETUP. */
export const SHORTCUT_NAME = 'Мозг-напомнить';
