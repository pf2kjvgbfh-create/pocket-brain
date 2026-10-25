// Rules parser for dictated Russian: normalize numbers → ordered rules (first match wins) → idea fallback.
// Rules only, synchronous and fast (invariant 4); the model may refine the card later.
import type { WalletRef } from '../config';
import { fold, normalize } from './normalize';
import { findTags, ideaFallback, ideaPrefixRule } from './rules/idea';
import { reminderDayPartRule, reminderExplicitRule, reminderImplicitRule } from './rules/reminder';
import { transferRule } from './rules/transfer';
import { heldRule } from './rules/held';
import { depositRule } from './rules/deposit';
import { subscriptionRule } from './rules/subscription';
import { incomeRule } from './rules/income';
import { expenseExplicitRule, expenseImplicitRule, expenseShortRule } from './rules/expense';
import type { ParseContext, ParsedFields, ParseResult, Rule, RuleMatch } from './types';

export type { Kind, ParsedFields, ParseResult } from './types';

/** Order = priority: the first rule that matches decides the kind. */
const RULES: Rule[] = [
  ideaPrefixRule,
  reminderExplicitRule,
  transferRule,
  heldRule,
  depositRule,
  subscriptionRule,
  incomeRule,
  expenseExplicitRule,
  reminderImplicitRule,
  expenseImplicitRule,
  reminderDayPartRule,
  expenseShortRule,
];

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

export function parse(text: string, now: Date, wallets: WalletRef[]): ParseResult {
  const norm = normalize(text);
  const ctx: ParseContext = { raw: text, norm, lower: fold(norm), now, wallets };
  const match = firstMatch(ctx);
  return {
    kind: match.kind,
    confidence: match.confidence,
    fields: compact(match.fields),
    tags: findTags(ctx.lower).tags,
    raw_text: text,
  };
}
