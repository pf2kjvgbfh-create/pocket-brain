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

/** The «Вклад» wallet of stages 0–6: never matched by speech, removed by migration v2 when unused. */
export const OLD_DEPOSIT_WALLET_ID = 'deposit';

/**
 * Default wallets with their spoken aliases (stems, so every case form matches). Stage 7: no «Вклад» wallet —
 * the word «вклад» means the kind `deposit` (DECISIONS 2026-10-26 item 9).
 */
export const DEFAULT_WALLETS: DefaultWallet[] = [
  { id: 'cash', name: 'Наличные', aliases: ['наличн', 'наличк', 'налик'] },
  { id: 'gold', name: 'Золотая карта', aliases: ['золот'] },
  { id: 'silver', name: 'Серебряная карта', aliases: ['серебрян'] },
  { id: 'tinkoff', name: 'Тинькофф', aliases: ['тиньк', 'тиньков', 'т-банк', 'тбанк'] },
];

/**
 * Banks that are not a wallet yet: «перевёл 10к на сбер» creates the wallet «Сбер» (owner, 2026-10-26). Only these
 * words make a new wallet: «перевёл 500 на телефон» stays as it was.
 */
export const KNOWN_BANKS: WalletRef[] = [
  { name: 'Сбер', aliases: ['сбер'] },
  { name: 'Альфа', aliases: ['альфа', 'альфу', 'альфе', 'альфой'] },
  { name: 'ВТБ', aliases: ['втб'] },
  { name: 'Озон', aliases: ['озон'] },
  { name: 'Яндекс', aliases: ['яндекс'] },
  { name: 'Газпромбанк', aliases: ['газпромбанк'] },
  { name: 'Райффайзен', aliases: ['райф'] },
  { name: 'Совкомбанк', aliases: ['совком'] },
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

/**
 * GitHub's page «new access key», pre-filled (name, owner, one year, write access to files). A plain link the owner
 * taps in Settings; the app never sends anything there (check:build allows only this exact prefix, DECISIONS stage 7).
 */
export const TOKEN_PAGE_PREFIX = 'https://github.com/settings/personal-access-tokens/new';
export const TOKEN_PAGE_URL =
  `${TOKEN_PAGE_PREFIX}?name=pocket-brain&description=${encodeURIComponent(`Backup for ${BACKUP.repo}`)}` +
  `&target_name=${encodeURIComponent(BACKUP.owner)}&expires_in=366&contents=write`;

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


/** The local model (stage 5, docs/model-eval.md). Shards live in public/model/; OFF by default (Settings). */
export const MODEL = {
  firstShard: 'qwen3-0.6b-q4_k_m-00001-of-00004.gguf',
  /** Shown on the Settings button (sum of the 4 shards, decimal MB). */
  sizeMb: 357,
  /** Exact size of each shard file in bytes (Pages sends them gzip-compressed, see `src/model/cache-fix.ts`). */
  shardBytes: {
    'qwen3-0.6b-q4_k_m-00001-of-00004.gguf': 95227424,
    'qwen3-0.6b-q4_k_m-00002-of-00004.gguf': 88661472,
    'qwen3-0.6b-q4_k_m-00003-of-00004.gguf': 89457024,
    'qwen3-0.6b-q4_k_m-00004-of-00004.gguf': 83248640,
  } as Record<string, number>,
  /** Qwen3: no <think> block. */
  noThinking: true,
  contextTokens: 1024,
  maxTokens: 24,
} as const;
