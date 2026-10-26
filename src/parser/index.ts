// Rules parser for dictated Russian: normalize numbers → ordered rules (first match wins) → idea fallback.
// Rules only, synchronous and fast (invariant 4); the model may refine the card later.
import type { WalletRef } from '../config';
import { findAmount } from './money';
import { fold, normalize } from './normalize';
import { findTags, ideaFallback, ideaPrefixRule } from './rules/idea';
import { reminderDayPartRule, reminderExplicitRule, reminderImplicitRule } from './rules/reminder';
import { transferRule } from './rules/transfer';
import { heldRule } from './rules/held';
import { debtRule } from './rules/debt';
import { depositRule } from './rules/deposit';
import { subscriptionRule } from './rules/subscription';
import { incomeRule } from './rules/income';
import { expenseExplicitRule, expenseImplicitRule, expenseLeadRule, expenseShortRule } from './rules/expense';
import { splitExpenses } from './many';
import { findHappened } from './when';
import type { Kind, ParseContext, ParsedFields, ParseResult, Rule, RuleMatch, Span } from './types';

export type { Kind, ParsedFields, ParseResult } from './types';

/** Order = priority: the first rule that matches decides the kind. */
const RULES: Rule[] = [
  ideaPrefixRule,
  reminderExplicitRule,
  transferRule,
  heldRule,
  debtRule,
  depositRule,
  subscriptionRule,
  incomeRule,
  expenseExplicitRule,
  reminderImplicitRule,
  expenseImplicitRule,
  reminderDayPartRule,
  expenseShortRule,
  expenseLeadRule,
];

/** Money that happened on a past day («вчера потратил 500») gets `happened_utc`. */
const PAST_KINDS: readonly Kind[] = ['expense', 'income', 'transfer', 'debt', 'repay'];

/** Drop empty fields so the card only shows what was understood. */
function compact(fields: ParsedFields): ParsedFields {
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined && v !== ''),
  ) as ParsedFields;
}

function firstMatch(ctx: ParseContext): RuleMatch {
  for (const rule of RULES) {
    const match = rule(ctx);
    if (match) return match;
  }
  return ideaFallback(ctx);
}

const blank = (text: string, spans: Span[]): string =>
  spans.reduce((t, s) => t.slice(0, s.start) + ' '.repeat(s.end - s.start) + t.slice(s.end), text);

interface Parsed {
  ctx: ParseContext;
  match: RuleMatch;
}

/**
 * «вчера» / «позавчера» (+ an hour) are cut out and the rules run again on the rest, so the day word never lands in a
 * title and never turns money into a reminder. Only for money kinds: «вчера вечером ходили в кино» stays as it was.
 */
function run(text: string, now: Date, wallets: WalletRef[]): Parsed {
  const norm = normalize(text);
  const ctx: ParseContext = { raw: text, norm, lower: fold(norm), now, wallets };
  const match = firstMatch(ctx);
  const past = findHappened(ctx.lower, now);
  if (!past) return { ctx, match };
  const pastCtx: ParseContext = { ...ctx, norm: blank(norm, past.spans), lower: blank(ctx.lower, past.spans) };
  const pastMatch = firstMatch(pastCtx);
  if (!PAST_KINDS.includes(pastMatch.kind)) return { ctx, match };
  return { ctx: pastCtx, match: { ...pastMatch, fields: { ...pastMatch.fields, happened_utc: past.utc } } };
}

function toResult(text: string, ctx: ParseContext, match: RuleMatch): ParseResult {
  const fields = { ...match.fields };
  const amount = findAmount(ctx.lower);
  if (fields.currency === undefined && amount?.currency && fields.amount_minor === amount.minor) fields.currency = amount.currency;
  return {
    kind: match.kind,
    confidence: match.confidence,
    fields: compact(fields),
    tags: findTags(ctx.lower).tags,
    raw_text: text,
    ...(match.walletless ? { walletless: true as const } : {}),
  };
}

export function parse(text: string, now: Date, wallets: WalletRef[]): ParseResult {
  const { ctx, match } = run(text, now, wallets);
  return toResult(text, ctx, match);
}

const isShortNote = (title: string): boolean => {
  const n = title.split(' ').filter((w) => w.length > 0).length;
  return n >= 1 && n <= 3;
};

/**
 * One phrase → one or more records: «купил кофе за 300 и круассан за 250» is two expenses (A4). Only expenses are
 * split; every other phrase gives exactly one result (= parse). Each result keeps the whole phrase as raw_text.
 */
export function parseMany(text: string, now: Date, wallets: WalletRef[]): ParseResult[] {
  const { ctx, match } = run(text, now, wallets);
  const whole = toResult(text, ctx, match);
  // «кофе 200, булочка 150 и сок 120» is too long for one short note, so the rules gave up (idea fallback).
  const unsureIdea = whole.kind === 'idea' && whole.confidence < 0.5;
  if (whole.kind !== 'expense' && !unsureIdea) return [whole];
  const parts = splitExpenses(ctx);
  if (parts.length < 2) return [whole];
  if (unsureIdea && !parts.every((p) => isShortNote(p.title))) return [whole];
  return parts.map((p) => ({
    ...whole,
    kind: 'expense',
    confidence: unsureIdea ? 0.6 : whole.confidence,
    fields: compact({
      title: p.title,
      amount_minor: p.amount_minor,
      currency: p.currency,
      wallet: p.wallet ?? whole.fields.wallet,
      happened_utc: whole.fields.happened_utc,
    }),
  }));
}
