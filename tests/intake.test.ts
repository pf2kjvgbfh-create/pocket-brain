import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { PocketDb } from '../src/db/db';
import { extractHashText, intakeText, isRepeatOpen } from '../src/ui/intake';
import { KIND_FIELDS, recordFromState, stateFromParse, stateFromRecord, understoodSentence } from '../src/ui/card-model';
import { walletRefs } from '../src/db/wallets';
import { parse } from '../src/parser/index';

const NOW = new Date('2026-10-22T09:00:00Z');
let counter = 0;
const open = (): Promise<PocketDb> => PocketDb.open(`intake-${(counter += 1)}`);

describe('extractHashText', () => {
  it('decodes percent-encoding and keeps a literal plus', () => {
    expect(extractHashText('#t=' + encodeURIComponent('напомни завтра в 19:00 позвонить маме'))).toBe('напомни завтра в 19:00 позвонить маме');
    expect(extractHashText('#t=2+2%20%3D%204')).toBe('2+2 = 4');
  });
  it('a literal percent sign does not stop the rest from decoding; null when there is no t=', () => {
    expect(extractHashText('#t=100%')).toBe('100%');
    expect(extractHashText('#t=' + encodeURIComponent('под ') + '6,5%')).toBe('под 6,5%');
    expect(extractHashText('#t=' + encodeURIComponent('под 6,5') + '%')).toBe('под 6,5%');
    expect(extractHashText('#t=%E0%A4%A')).toBe('%E0%A4%A');
    expect(extractHashText('')).toBeNull();
    expect(extractHashText('#other')).toBeNull();
    expect(extractHashText('#t=')).toBe('');
  });
});

describe('intakeText', () => {
  it('the same link twice reuses the pending draft (one draft)', async () => {
    const db = await open();
    const a = await intakeText(db, 'привет', NOW, { link: true, repeat: false });
    const b = await intakeText(db, 'привет', NOW, { link: true, repeat: false });
    expect(a.type).toBe('draft');
    expect(b.type).toBe('draft');
    if (a.type === 'draft' && b.type === 'draft') expect(b.draft.id).toBe(a.draft.id);
    expect(await db.listDrafts()).toHaveLength(1);
  });

  it('a REPEATED opening (reload / back): a record with the same raw text from the last 10 minutes is «already saved»', async () => {
    const db = await open();
    const a = await intakeText(db, 'привет', NOW, { link: true, repeat: false });
    if (a.type !== 'draft') throw new Error('draft expected');
    const rec = recordFromState(stateFromParse(a.draft.id, parse('привет', NOW, []), []), NOW);
    await db.saveFromDraft(rec, a.draft.id);
    const again = await intakeText(db, 'привет', new Date(NOW.getTime() + 5 * 60_000), { link: true, repeat: true });
    expect(again.type).toBe('saved');
    expect(await db.listDrafts()).toHaveLength(0);
    // 11 minutes later even a repeat is a new draft.
    const later = await intakeText(db, 'привет', new Date(NOW.getTime() + 11 * 60_000), { link: true, repeat: true });
    expect(later.type).toBe('draft');
  });

  it('a FRESH link with a phrase saved a minute ago is a new dictation: a new draft (DECISIONS item 11)', async () => {
    const db = await open();
    const a = await intakeText(db, 'кофе 200', NOW, { link: true, repeat: false });
    if (a.type !== 'draft') throw new Error('draft expected');
    await db.saveFromDraft(recordFromState(stateFromParse(a.draft.id, parse('кофе 200', NOW, []), []), NOW), a.draft.id);
    const b = await intakeText(db, 'кофе 200', new Date(NOW.getTime() + 60_000), { link: true, repeat: false });
    expect(b.type).toBe('draft');
    if (b.type === 'draft') expect(b.draft.id).not.toBe(a.draft.id);
  });

  it('only the first read on a reload / back-forward, or a page restored from memory, is a repeat', () => {
    expect(isRepeatOpen('reload', false, true)).toBe(true);
    expect(isRepeatOpen('back_forward', false, true)).toBe(true);
    expect(isRepeatOpen('navigate', false, true)).toBe(false);
    expect(isRepeatOpen(undefined, false, true)).toBe(false);
    expect(isRepeatOpen('reload', false, false)).toBe(false); // a later hashchange in a reloaded tab is new
    expect(isRepeatOpen(undefined, true, false)).toBe(true); // pageshow.persisted
  });

  it('typed text always makes a new draft', async () => {
    const db = await open();
    const a = await intakeText(db, 'раз', NOW, { link: false, repeat: false });
    const b = await intakeText(db, 'раз', NOW, { link: false, repeat: false });
    if (a.type === 'draft' && b.type === 'draft') expect(a.draft.id).not.toBe(b.draft.id);
    expect(await db.listDrafts()).toHaveLength(2);
  });
});

describe('card model', () => {
  const wallets = [
    { id: 'gold', name: 'Золотая карта', hidden: false, start_balance_minor: 0 },
    { id: 'cash', name: 'Наличные', hidden: true, start_balance_minor: 0 },
  ];
  const refs = walletRefs(wallets);

  it('reminder: sentence and MSK time', () => {
    const p = parse('напомни завтра в 19:00 позвонить маме', NOW, refs);
    const s = stateFromParse('id1', p, wallets);
    expect(s.kind).toBe('reminder');
    expect(s.due).toBe('2026-10-23T19:00');
    expect(understoodSentence(s, wallets, NOW)).toBe('Понял так: напоминание, завтра 19:00 МСК');
    const r = recordFromState(s, NOW);
    expect(r.due_utc).toBe('2026-10-23T16:00:00.000Z');
    expect(r.fields.title).toBe('позвонить маме');
    expect(r.raw_text).toBe('напомни завтра в 19:00 позвонить маме');
  });

  it('expense: wallet id, kopecks and sentence', () => {
    const p = parse('купил воду за пятьсот рублей золотая карта', NOW, refs);
    const s = stateFromParse('id2', p, wallets);
    expect(understoodSentence(s, wallets, NOW)).toBe('Понял так: расход 500,00 ₽, Золотая карта');
    const r = recordFromState(s, NOW);
    expect(r.kind).toBe('expense');
    expect(r.wallet_id).toBe('gold');
    expect(r.fields.amount_minor).toBe(50000);
  });

  it('held: who, amount and rate are kept', () => {
    const p = parse('Иван отдал мне на хранение 3000, положил под 6,5%', NOW, refs);
    const r = recordFromState(stateFromParse('id3', p, wallets), NOW);
    expect(r.kind).toBe('held');
    expect(r.fields).toMatchObject({ who: 'Иван', amount_minor: 300000, rate: 6.5 });
  });

  it('unclear phrase: idea, raw text kept, save works with empty fields', () => {
    const p = parse('что-то непонятное про вторник', NOW, refs);
    const s = stateFromParse('id4', p, wallets);
    expect(s.kind).toBe('idea');
    const r = recordFromState({ ...s, title: '', tags: '' }, NOW);
    expect(r.raw_text).toBe('что-то непонятное про вторник');
    expect(r.fields).toEqual({});
    expect(r.deleted).toBe(false);
  });

  it('every kind saves from a fully empty card', () => {
    for (const kind of Object.keys(KIND_FIELDS) as (keyof typeof KIND_FIELDS)[]) {
      const s = { ...stateFromParse('e', parse('x', NOW, []), []), kind, title: '', tags: '' };
      expect(recordFromState(s, NOW).kind).toBe(kind);
    }
  });

  it('a hidden wallet id is kept when the card is re-saved', () => {
    const p = parse('потратил 100 рублей наличными', NOW, refs);
    // Stage 7: speech no longer finds a hidden wallet (DECISIONS item 10), so the id comes from an edit / an old record.
    expect(p.fields.wallet).toBeUndefined();
    const rec = recordFromState({ ...stateFromParse('id5', p, wallets), walletId: 'cash' }, NOW);
    expect(rec.wallet_id).toBe('cash');
    const again = recordFromState(stateFromRecord(rec), NOW);
    expect(again.wallet_id).toBe('cash');
    expect(again.created_utc).toBe(rec.created_utc);
  });

  it('fields that do not belong to the chosen kind are not saved', () => {
    const p = parse('напомни завтра в 19:00 позвонить маме', NOW, refs);
    const s = { ...stateFromParse('id6', p, wallets), kind: 'idea' as const };
    const r = recordFromState(s, NOW);
    expect(r.due_utc).toBeNull();
  });

  it('subscription: due is the next day-of-month', () => {
    const p = parse('подписка на облако 149 рублей 1-го числа', NOW, refs);
    const r = recordFromState(stateFromParse('id7', p, wallets), NOW);
    expect(r.fields).toMatchObject({ amount_minor: 14900, day: 1 });
    expect(r.due_utc).toBe('2026-11-01T09:00:00.000Z');
  });
});
