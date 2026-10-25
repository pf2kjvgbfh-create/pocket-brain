// What the local model is asked and how its answer is read. The model only names the KIND of a note the rules were
// unsure about; amounts, dates and wallets always come from the rules (invariant 11: model output is untrusted).
import type { Kind } from '../parser/types';

export const MODEL_KINDS: readonly Kind[] = ['reminder', 'expense', 'income', 'transfer', 'held', 'deposit', 'subscription', 'idea'];

// English instructions: about half the tokens of the same text in Russian (the prompt is the slow part on a phone).
const SYSTEM =
  'Classify a short Russian note. Reply JSON {"kind": K}. K is one of:\n' +
  'reminder: a task for a time or day; expense: money spent, a purchase or a paid service (also "кофе 300");\n' +
  'income: money received, sold something; transfer: money moved between my own cards or cash;\n' +
  "held: someone else's money kept by me; deposit: money put on a deposit or savings account at a rate;\n" +
  'subscription: a monthly payment; idea: a thought, wish or plan without a date, anything else.\n' +
  'Examples: "мороженое 150" expense; "продал телефон за 8000" income; "в четверг вечером занести документы" reminder; ' +
  '"хочу выучить испанский" idea; "Петя оставил у меня 3000" held; "музыка каждый месяц 199" subscription.';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export function buildMessages(text: string): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: text },
  ];
}

/** JSON schema for constrained output (wllama turns it into a grammar). */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: { kind: { type: 'string', enum: [...MODEL_KINDS] } },
  required: ['kind'],
  additionalProperties: false,
} as const;

/** The kind from the model's answer, or null when the answer is not valid. */
export function readKind(content: string | null | undefined): Kind | null {
  if (!content) return null;
  try {
    const v: unknown = JSON.parse(content.trim());
    const kind = typeof v === 'object' && v !== null ? (v as { kind?: unknown }).kind : undefined;
    return typeof kind === 'string' && (MODEL_KINDS as string[]).includes(kind) ? (kind as Kind) : null;
  } catch {
    return null;
  }
}
