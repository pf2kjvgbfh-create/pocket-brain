// App-wide configurable values (invariant 8: defaults live here, not scattered in code).

export interface WalletRef {
  /** Canonical wallet name shown in the UI and returned by the parser. */
  name: string;
  /** Lower-case word stems that refer to this wallet in speech (matched at a word start). */
  aliases?: string[];
}

/** Default wallets with their spoken aliases (stems, so every case form matches). */
export const DEFAULT_WALLETS: WalletRef[] = [
  { name: 'Наличные', aliases: ['наличн', 'наличк', 'налик'] },
  { name: 'Вклад', aliases: ['вклад'] },
  { name: 'Золотая карта', aliases: ['золот'] },
  { name: 'Серебряная карта', aliases: ['серебрян'] },
  { name: 'Тинькофф', aliases: ['тиньк', 'тиньков', 'т-банк', 'тбанк'] },
];

/** Moscow offset in minutes: every parsed time is interpreted in MSK regardless of the phone zone. */
export const MSK_OFFSET_MIN = 180;

/** Time used when a date is said without an hour (MSK). */
export const DEFAULT_HOUR_MSK = 12;
