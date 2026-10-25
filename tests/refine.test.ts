// Stage 5: the local model only names the kind; amounts, dates and wallets still come from the rules (invariant 11).
import { describe, expect, it } from 'vitest';
import { DEFAULT_WALLETS } from '../src/config';
import type { RecordRow, WalletRow } from '../src/db/types';
import { refineRecord } from '../src/model/refine';

const NOW = new Date('2026-10-22T09:30:00Z');
const CREATED = '2026-10-22T09:00:00.000Z'; // Thursday 12:00 MSK
const wallets: WalletRow[] = DEFAULT_WALLETS.map((w) => ({ id: w.id, name: w.name, hidden: false, start_balance_minor: 0 }));

const idea = (text: string, over: Partial<RecordRow> = {}): RecordRow => ({
  id: 'r1', kind: 'idea', raw_text: text, fields: { title: text }, wallet_id: null, due_utc: null,
  created_utc: CREATED, updated_utc: CREATED, deleted: false, refine: 'pending', ...over,
});
const refine = (rec: RecordRow, kind: Parameters<typeof refineRecord>[0]['kind'], lastWalletId: string | null = null) =>
  refineRecord({ record: rec, kind, wallets, lastWalletId, now: NOW });

describe('refineRecord', () => {
  it('expense: the amount and the title from the rules, the last wallet, the flag cleared, id and time kept', () => {
    const out = refine(idea('репетитор по английскому 2000 за урок'), 'expense', 'silver');
    expect(out).not.toBeNull();
    expect(out).toMatchObject({ id: 'r1', kind: 'expense', wallet_id: 'silver', created_utc: CREATED, updated_utc: NOW.toISOString() });
    expect(out?.fields.amount_minor).toBe(200000);
    expect(out?.refine).toBeUndefined();
  });

  it('a wallet named in the text wins over the last wallet', () => {
    expect(refine(idea('сапоги 7000 с золотой'), 'expense', 'silver')?.wallet_id).toBe('gold');
  });

  it('income keeps the amount from the text', () => {
    const out = refine(idea('за консультацию 3000'), 'income');
    expect(out?.kind).toBe('income');
    expect(out?.fields.amount_minor).toBe(300000);
  });

  it('a money kind without any amount in the text stays an idea (the model never invents numbers)', () => {
    expect(refine(idea('купить подарок маме'), 'expense')).toBeNull();
  });

  it('reminder: the date from the text, in MSK, from the time the phrase was said', () => {
    const out = refine(idea('в пятницу встреча с юристом'), 'reminder');
    expect(out?.kind).toBe('reminder');
    expect(out?.due_utc).toBe('2026-10-23T09:00:00.000Z'); // Friday 12:00 MSK
  });

  it('reminder without any date in the text stays an idea', () => {
    expect(refine(idea('позвонить сантехнику'), 'reminder')).toBeNull();
  });

  it('idea, an invalid answer, or a kind the rules cannot fill → nothing changes', () => {
    expect(refine(idea('мысль про отпуск'), 'idea')).toBeNull();
    expect(refine(idea('мысль про отпуск'), null)).toBeNull();
    expect(refine(idea('Петя 3000'), 'held')).toBeNull();
  });

  it('a record the owner already changed (no flag, or not an idea any more) is never touched', () => {
    expect(refine(idea('такси 650', { refine: undefined }), 'expense')).toBeNull();
    expect(refine(idea('такси 650', { kind: 'reminder' }), 'expense')).toBeNull();
    expect(refine(idea('такси 650', { deleted: true }), 'expense')).toBeNull();
  });
});
