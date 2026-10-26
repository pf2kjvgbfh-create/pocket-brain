// People in debts and returns: «одолжил Пете», «взял в долг у Пети», «Маша должна мне». The name is turned back into
// its dictionary form by a few ending rules (no dictionary): «Пете» / «Пети» → «Петя», «Ивану» → «Иван».
import { fold } from './normalize';

/** Relation words that stand in for a name in lower case («одолжил брату»). */
const RELATIONS = /^(?:брат|сестр|мам|пап|друг|подруг|сосед|коллег|сын|доч|бабушк|дедушк|дяд|тет|тёт|начальник|шеф|нян)/u;
const NOT_A_NAME = new Set(['мне', 'я', 'мы', 'ты', 'вы', 'он', 'она', 'они', 'ему', 'ей', 'им', 'его', 'ее', 'её', 'их', 'долг', 'в', 'у', 'от', 'за', 'на', 'с', 'со', 'и', 'деньги', 'денег']);

const HUSH_VELAR = /[жшщчгкх]$/u;
const HARD_A = /[мрбпвф]$/u;
const VOWEL = /[аеёиоуыэюя]$/u;

export type NameCase = 'nom' | 'gen' | 'dat';

/** «Пете» (dat) / «Пети» (gen) → «Петя», «Ивану» → «Иван», «Сергею» → «Сергей», «Игоря» → «Игорь». Best effort. */
export function nominative(word: string, nameCase: NameCase): string {
  const w = word;
  const stem = w.slice(0, -1);
  const last = fold(w.slice(-1));
  const aOrYa = (): string => (HUSH_VELAR.test(fold(stem)) || HARD_A.test(fold(stem)) ? `${stem}а` : `${stem}я`);
  if (nameCase === 'dat') {
    if (last === 'у' && !VOWEL.test(fold(stem))) return stem;
    if (last === 'ю') return VOWEL.test(fold(stem)) ? `${stem}й` : `${stem}ь`;
    if (last === 'е' || last === 'и') return aOrYa();
  }
  if (nameCase === 'gen') {
    if (last === 'а' && !VOWEL.test(fold(stem))) return stem;
    if (last === 'я') return VOWEL.test(fold(stem)) ? `${stem}й` : `${stem}ь`;
    if (last === 'ы') return `${stem}а`;
    if (last === 'и') return HUSH_VELAR.test(fold(stem)) ? `${stem}а` : `${stem}я`;
  }
  return w;
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** «маме», «брату»: a relation word, not a name. */
export const isRelation = (word: string): boolean => RELATIONS.test(fold(word));

/** A word that can be a person: capitalised (dictation capitalises names) or a relation word, not a pronoun. */
export function looksLikePerson(word: string | undefined): boolean {
  if (!word || !/^\p{L}/u.test(word) || NOT_A_NAME.has(fold(word))) return false;
  return /^\p{Lu}/u.test(word) || isRelation(word);
}

/**
 * Male names whose dative ends in -у / -ю («Ивану», «Сергею»). Only these: «вернул книгу», «вернул сдачу» look the same
 * and are not people, so a lower-case -у word is a person only when it is a known name.
 */
const MALE_DATIVE = new RegExp(
  '^(?:' +
    'иван|петр|серге|андре|алексе|дмитри|михаил|никола|владимир|павл|артем|максим|евгени|игор|олег|роман|антон|' +
    'денис|юри|виктор|вадим|кирилл|егор|глеб|тимур|руслан|влад|степан|борис|григори|федор|константин|леонид|' +
    'геннади|валери|анатоли|арсени|марк|матве|ярослав|станислав|вячеслав|эдуард|аркади|семен|яков|льв|тимофе|' +
    'георги|васили|данил|даниил|филипп|захар|богдан|альберт|ростислав|всеволод|савели|прохор|арсен|рустам' +
    ')[ую]$',
  'u',
);
/** Words ending like a female dative (-е, -ии) that are not people («отдал все 2000», «вернул свои»). */
const NOT_DATIVE = new Set(['все', 'свои', 'мои', 'твои', 'наши', 'ваши', 'эти', 'те', 'обе', 'сдаче', 'обратно', 'тоже', 'уже', 'еще', 'позже', 'раньше']);

/**
 * A name in the dative written in any case («ивану», «маше», «Сергею», «марии»): a known male name in -у/-ю, or a word
 * of 3+ letters ending in consonant + е or in -ии (female names and diminutives: «Пете», «Оле», «Марии»).
 */
export function looksLikeDativeName(word: string): boolean {
  const w = fold(word);
  if (!/^\p{L}{3,}$/u.test(w) || NOT_A_NAME.has(w) || NOT_DATIVE.has(w)) return false;
  return MALE_DATIVE.test(w) || /[бвгджзклмнпрстфхцчшщ]е$/u.test(w) || /ии$/u.test(w);
}

/** The person as stored: dictionary form, capitalised. */
export function personName(word: string, nameCase: NameCase): string {
  return capitalize(nominative(word, nameCase));
}

/** Grouping key for one person across records (case-insensitive, one ending dropped: «Петя» = «Пете»). */
export function personKey(who: string | undefined): string {
  return fold((who ?? '').trim()).replace(/(?:ой|ей|ом|ем|[аяуюеиыйь])$/u, '');
}

export interface WordAt {
  text: string;
  start: number;
  end: number;
}

/** Words (letters or numbers) of the case-preserved text with their positions. */
export function wordsOf(norm: string): WordAt[] {
  return [...norm.matchAll(/[\p{L}-]+|\d+(?:[.,]\d+)?/gu)].map((m) => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
}
