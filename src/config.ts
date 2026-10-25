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
export const APP_VERSION = '0.4.0';

/** A record with the same raw text saved within this window counts as "already saved" (opening one link twice). */
export const DUPLICATE_WINDOW_MIN = 10;

/** How many latest operations the money screen lists. */
export const RECENT_OPERATIONS = 15;

/** Name of the iPhone Shortcut the owner builds by hand (SETUP section 4). Never rename without updating SETUP. */
export const SHORTCUT_NAME = 'Мозг-напомнить';

/** GitHub backup (stage 4). The token is typed by the owner into Settings and lives only in the settings store. */
export const BACKUP = {
  owner: 'pf2kjvgbfh-create',
  repo: 'pocket-brain-data',
  mainPath: 'data/pocket-brain.json',
  /** `YYYY-MM` is replaced with the UTC month of `created_utc`. */
  monthPathPattern: 'data/records-YYYY-MM.json',
  /** Above this many UTF-8 bytes the backup is split by month. */
  splitBytes: 1_000_000,
  maxRetries: 3,
  backoffMs: [500, 1500, 3000],
  /** One request must not hang forever: a stuck request would block every later backup. */
  timeoutMs: 30_000,
  apiVersion: '2022-11-28',
} as const;

/** Settings keys of the autosave stage (stored in the `settings` store). */
export const LAST_WALLET_KEY = 'last_wallet_id';
export const LEARNED_KEY = 'learned';

/**
 * Settings keys that may be written to a backup or an export. Everything else (above all the token) is left out.
 * Add a key here on purpose, never by accident; a restored value is validated before it is applied.
 */
export const BACKUP_SETTING_KEYS: readonly string[] = [LAST_WALLET_KEY, LEARNED_KEY];

/** How long the «Записал: …» toast with «Отменить» stays; a reminder opens in «Напоминания» when this passes untouched. */
export const UNDO_MS = 5000;

/** Short toasts without buttons («Отменено»). */
export const TOAST_SHORT_MS = 2500;

/** Corrections memory: the most entries kept; the oldest are dropped first. */
export const LEARNED_MAX = 500;
