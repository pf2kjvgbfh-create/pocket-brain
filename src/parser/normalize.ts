// Russian number words → digits, so chrono and the money regexes see «завтра в 7 вечера», «3200», «6,5 процента».
// Only number tokens are replaced; every other character (and its case) is kept.

const SMALL: Record<string, number> = {
  ноль: 0, один: 1, одна: 1, одно: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4,
  пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
  одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15,
  шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19,
  двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60,
  семьдесят: 70, восемьдесят: 80, девяносто: 90,
  сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500,
  шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900,
};

const MULTIPLIERS: Record<string, number> = {
  тысяча: 1000, тысячи: 1000, тысяч: 1000, тысячу: 1000, тыс: 1000,
  // spoken «тыща»
  тыща: 1000, тыщи: 1000, тыщ: 1000, тыщу: 1000,
  миллион: 1_000_000, миллиона: 1_000_000, миллионов: 1_000_000, млн: 1_000_000,
};

const ORDINALS: Record<string, number> = {
  первого: 1, второго: 2, третьего: 3, четвертого: 4, пятого: 5, шестого: 6, седьмого: 7,
  восьмого: 8, девятого: 9, десятого: 10, одиннадцатого: 11, двенадцатого: 12,
  тринадцатого: 13, четырнадцатого: 14, пятнадцатого: 15, шестнадцатого: 16,
  семнадцатого: 17, восемнадцатого: 18, девятнадцатого: 19, двадцатого: 20, тридцатого: 30,
};
// «каждое пятое число»: the neuter form ends in -ое instead of -ого.
for (const [w, n] of Object.entries(ORDINALS)) ORDINALS[w.replace(/ого$/, 'ое')] = n;

const HALF_AND_ONE = new Set(['полтора', 'полторы']);

/** Lower-case + ё→е; keeps the string length (positions stay valid). */
export function fold(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е');
}

const TOKEN_RE = /\p{L}+|\d+(?:[.,]\d+)?|[^\p{L}\d]+/gu;
const isDigits = (t: string | undefined): boolean => t !== undefined && /^\d/.test(t);
const isSpace = (t: string | undefined): boolean => t !== undefined && /^[ \t]+$/.test(t);
const toNumber = (t: string): number => Number(t.replace(',', '.'));

interface NumberRead {
  value: number;
  ordinal: boolean;
  end: number; // index of the first token after the number
}

/** Index of the next non-space token after `i` (or -1). */
function nextWord(tokens: string[], i: number): number {
  return isSpace(tokens[i + 1]) && tokens[i + 2] !== undefined ? i + 2 : -1;
}

/** Russian order inside a group below 1000: hundreds → tens → units. So «семь тридцать» is two
 *  numbers (7 30, a clock time), not 37. `prev` = the previous word's value in this group (-1 = none allowed). */
function canFollow(prev: number | undefined, value: number): boolean {
  if (prev === undefined) return true;
  if (prev >= 100) return value < 100;
  if (prev >= 20 && prev % 10 === 0) return value >= 1 && value <= 9;
  return false;
}

/** Try to read one spoken number starting at token `i`. */
function readNumber(tokens: string[], i: number): NumberRead | null {
  let total = 0;
  let current = 0;
  let used = false;
  let lastWasMultiplier = false;
  let prev: number | undefined;
  let end = i;
  let j = i;
  while (j < tokens.length) {
    const tok = tokens[j];
    const w = fold(tok);
    const nw = nextWord(tokens, j);
    const next = nw >= 0 ? fold(tokens[nw]) : '';
    if (isDigits(tok)) {
      if (!used && (next in MULTIPLIERS || next === 'с')) current = toNumber(tok);
      else if (lastWasMultiplier && /^\d{1,3}$/.test(tok)) current += toNumber(tok);
      else break;
      prev = -1;
    } else if (w in SMALL && canFollow(prev, SMALL[w])) {
      current += SMALL[w];
      prev = SMALL[w];
    } else if (HALF_AND_ONE.has(w) && !used && next in MULTIPLIERS) {
      current = 1.5;
      prev = -1;
    } else if (w in MULTIPLIERS && (used || w !== 'тыс')) {
      total += (current || 1) * MULTIPLIERS[w];
      current = 0;
      prev = undefined;
    } else if (w in ORDINALS && canFollow(prev, ORDINALS[w])) {
      return { value: total + current + ORDINALS[w], ordinal: true, end: j + 1 };
    } else if (w === 'с' && used && next === 'половиной') {
      current += 0.5;
      prev = -1;
      j = nw;
    } else {
      break;
    }
    used = true;
    lastWasMultiplier = w in MULTIPLIERS;
    end = j + 1;
    const after = nextWord(tokens, j);
    if (after < 0) break;
    j = after;
  }
  return used ? { value: total + current, ordinal: false, end } : null;
}

function formatNumber(n: NumberRead): string {
  const v = Math.round(n.value * 100) / 100;
  if (n.ordinal) return `${v}-го`;
  return Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
}

/** «3 000» / «3 000» (NBSP) → «3000». */
function joinDigitGroups(s: string): string {
  return s.replace(/(?<![\d.,])\d{1,3}(?: \d{3})+(?!\d)/g, (m) => m.replace(/ /g, ''));
}

/** «5к» / «2,5к» → «5000» / «2500» (the spoken «к» = thousand, written right after the number). */
function kiloAmounts(s: string): string {
  return s.replace(/(?<![\p{L}\d.,])(\d+(?:[.,]\d+)?)к(?![\p{L}\d])/giu, (_m, n: string) => String(Math.round(toNumber(n) * 1000)));
}

/** Normalize dictated Russian text. The original text must be kept separately by the caller. */
export function normalize(text: string): string {
  const spaced = kiloAmounts(joinDigitGroups(text.replace(/[   ]/g, ' '))
    // chrono reads «полтора часа» as one hour; say it in minutes.
    .replace(/(?<![\p{L}\d])полтора\s+час\p{L}*/giu, '90 минут'));
  const tokens = spaced.match(TOKEN_RE) ?? [];
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const n = readNumber(tokens, i);
    if (n) {
      out.push(formatNumber(n));
      i = n.end;
    } else {
      out.push(tokens[i]);
      i += 1;
    }
  }
  return spokenClock(out.join(''));
}

/** «в 7 30» (from «в семь тридцать») → «в 7:30». Not when money/percent follows. */
function spokenClock(s: string): string {
  return s.replace(
    /(?<![\p{L}\d])(в\s+)(\d{1,2}) ([0-5]\d)(?![\d,.]|\s*(?:руб|р\.|₽|тыс|млн|%|процент))/giu,
    (m, pre: string, hh: string, mm: string) => (Number(hh) <= 23 ? `${pre}${hh}:${mm}` : m),
  );
}
