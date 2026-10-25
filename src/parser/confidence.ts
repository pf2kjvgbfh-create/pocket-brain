// «Are the rules unsure?» The flag only marks a record for the local model (stage 5); nothing is shown for it.
import type { Kind, ParseResult } from './types';

const MONEY_KINDS: readonly Kind[] = ['expense', 'income', 'transfer', 'held', 'deposit', 'subscription'];

/** Below this the parser fell back to an idea because nothing matched (see ParseResult.confidence). */
const UNSURE_BELOW = 0.5;

export function needsModel(result: ParseResult): boolean {
  if (result.kind === 'idea') return result.confidence < UNSURE_BELOW;
  if (result.kind === 'reminder') return result.fields.due_utc === undefined;
  return MONEY_KINDS.includes(result.kind) && result.fields.amount_minor === undefined;
}
