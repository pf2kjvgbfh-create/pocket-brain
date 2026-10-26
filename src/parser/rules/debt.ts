// Debts («одолжил Пете 3000», «взял в долг у Пети 2000», «Маша должна мне 1500») and their returns
// («вернул Ивану 2000», «Петя вернул мне 3000»). The person is a capitalised word or a relation word («брату»).
// «Должен / должна» moves no money → walletless (autosave sets no default wallet).
import { findAmount } from '../money';
import { looksLikePerson, personName, type NameCase } from '../names';
import { findWallets, firstWallet } from '../wallets';
import type { Direction, Kind, ParseContext, Rule, RuleMatch } from '../types';

const B = '(?<![\\p{L}\\d])';
const W = '([\\p{L}-]+)';

interface Pattern {
  re: RegExp;
  kind: Kind;
  direction: Direction;
  nameCase: NameCase;
  walletless?: true;
  /** Extra text the phrase must contain. */
  needs?: RegExp;
}

const IN_DEBT = /(?<![\p{L}])в\s+долг(?![\p{L}])/u;
const THEIR_MONEY = /(?<![\p{L}])(?:его|ее|их)\s+деньг/u;

// `d`: group indices, so the name is taken from the case-preserved text at the same place.
const pattern = (src: string): RegExp => new RegExp(`${B}${src}(?![\\p{L}\\d])`, 'du');

/** Order matters: the more specific forms first. */
const PATTERNS: Pattern[] = [
  { re: pattern(`${W}\\s+должн[аы]?\\s+мне`), kind: 'debt', direction: 'to_me', nameCase: 'nom', walletless: true },
  { re: pattern(`${W}\\s+должен\\s+мне`), kind: 'debt', direction: 'to_me', nameCase: 'nom', walletless: true },
  { re: pattern(`мне\\s+(?:должен|должн[аы]?)\\s+${W}`), kind: 'debt', direction: 'to_me', nameCase: 'nom', walletless: true },
  { re: pattern(`я\\s+(?:должен|должна)\\s+${W}`), kind: 'debt', direction: 'from_me', nameCase: 'dat', walletless: true },
  { re: pattern(`(?:взял[аи]?|занял[аи]?|одолжил[аи]?)(?:\\s+в\\s+долг)?\\s+у\\s+${W}`), kind: 'debt', direction: 'from_me', nameCase: 'gen' },
  { re: pattern(`${W}\\s+(?:одолжил[аи]?|занял[аи]?)\\s+мне`), kind: 'debt', direction: 'from_me', nameCase: 'nom' },
  { re: pattern(`${W}\\s+дал[аи]?\\s+мне`), kind: 'debt', direction: 'from_me', nameCase: 'nom', needs: IN_DEBT },
  { re: pattern(`(?:одолжил[а]?|занял[а]?)\\s+${W}`), kind: 'debt', direction: 'to_me', nameCase: 'dat' },
  { re: pattern(`дал[а]?(?:\\s+в\\s+долг)?\\s+${W}`), kind: 'debt', direction: 'to_me', nameCase: 'dat', needs: IN_DEBT },
  { re: pattern(`${W}\\s+вернул[аи]?\\s+мне`), kind: 'repay', direction: 'to_me', nameCase: 'nom' },
  { re: pattern(`(?:вернул[а]?|отдал[а]?)\\s+долг\\s+${W}`), kind: 'repay', direction: 'by_me', nameCase: 'dat' },
  { re: pattern(`вернул[а]?(?:\\s+долг)?\\s+${W}`), kind: 'repay', direction: 'by_me', nameCase: 'dat' },
  { re: pattern(`отдал[а]?\\s+${W}`), kind: 'repay', direction: 'by_me', nameCase: 'dat', needs: THEIR_MONEY },
];

function match(ctx: ParseContext, p: Pattern): RuleMatch | null {
  if (p.needs && !p.needs.test(ctx.lower)) return null;
  const m = p.re.exec(ctx.lower);
  if (!m) return null;
  const [start, end] = m.indices?.[1] ?? [0, 0];
  const word = ctx.norm.slice(start, end);
  if (!looksLikePerson(word)) return null;
  const amount = findAmount(ctx.lower);
  const wallet = p.walletless ? undefined : firstWallet(findWallets(ctx.lower, ctx.wallets))?.name;
  return {
    kind: p.kind,
    confidence: amount ? 0.9 : 0.6,
    fields: { who: personName(word, p.nameCase), amount_minor: amount?.minor, direction: p.direction, wallet, currency: amount?.currency },
    walletless: p.walletless,
  };
}

export const debtRule: Rule = (ctx) => {
  for (const p of PATTERNS) {
    const found = match(ctx, p);
    if (found) return found;
  }
  return null;
};
