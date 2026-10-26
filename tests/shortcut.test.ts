import { describe, expect, it } from 'vitest';
import { SHORTCUT_NAME } from '../src/config';
import type { RecordRow } from '../src/db/types';
import { buildPayload, buildShortcutUrl } from '../src/shortcut/payload';
import { buildAutoRecord } from '../src/ui/autosave';

const NOW = new Date('2026-10-22T09:00:00Z');

function rec(over: Partial<RecordRow>): RecordRow {
  return {
    id: 'r1',
    kind: 'reminder',
    raw_text: 'напомни завтра в 19:00 позвонить маме',
    fields: { title: 'позвонить маме' },
    wallet_id: null,
    due_utc: '2026-10-23T16:00:00.000Z',
    created_utc: NOW.toISOString(),
    updated_utc: NOW.toISOString(),
    deleted: false,
    ...over,
  };
}

/** Expected «YYYY-MM-DD HH:mm» in the zone this test process runs in (independent of the code under test). */
function localOracle(utcIso: string): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Date(utcIso).toLocaleString('sv-SE', { timeZone: zone, hour12: false }).slice(0, 16);
}

describe('buildPayload', () => {
  it('reminder: exactly the five documented fields', () => {
    const p = buildPayload(rec({}), NOW);
    expect(p).toEqual({
      title: 'позвонить маме — 19:00 МСК',
      due: '2026-10-23T19:00:00+03:00',
      due_local: localOracle('2026-10-23T16:00:00Z'),
      due_msk: '23.10 19:00 МСК',
      repeat: 'none',
    });
  });

  it('due is the same text in any device zone; due_local follows the device zone', () => {
    const p = buildPayload(rec({}), NOW);
    expect(p?.due).toBe('2026-10-23T19:00:00+03:00');
    if (process.env.TZ === 'UTC') expect(p?.due_local).toBe('2026-10-23 16:00');
    if (process.env.TZ === 'America/New_York') expect(p?.due_local).toBe('2026-10-23 12:00');
    expect(p?.due_local).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('due and due_local denote the same instant; the year is added for another year', () => {
    const p = buildPayload(rec({ due_utc: '2026-12-31T21:30:00.000Z' }), NOW);
    expect(p?.due).toBe('2027-01-01T00:30:00+03:00');
    expect(Date.parse(p!.due)).toBe(Date.parse('2026-12-31T21:30:00Z'));
    expect(p?.due_local).toBe(localOracle('2026-12-31T21:30:00Z'));
    expect(p?.due_msk).toBe('01.01.2027 00:30 МСК');
  });

  it('title falls back to the raw text; both carry the Moscow time', () => {
    expect(buildPayload(rec({ fields: {} }), NOW)?.title).toBe('напомни завтра в 19:00 позвонить маме — 19:00 МСК');
    expect(buildPayload(rec({ fields: { title: '' } }), NOW)?.title).toBe('напомни завтра в 19:00 позвонить маме — 19:00 МСК');
  });

  it('the Moscow time in the title is the MSK clock, whatever the device zone', () => {
    expect(buildPayload(rec({ due_utc: '2026-12-31T21:30:00.000Z' }), NOW)?.title).toBe('позвонить маме — 00:30 МСК');
    expect(buildPayload(rec({ due_utc: '2026-10-23T09:05:00.000Z' }), NOW)?.title).toBe('позвонить маме — 12:05 МСК');
  });

  it('DST: «5 ноября в 19:00» said on 30.10 -> due +03:00, due_local follows the phone zone (EST after 1 Nov)', () => {
    const now = new Date('2026-10-30T10:00:00Z');
    const text = 'напомни 5 ноября в 19:00 позвонить маме';
    const { record } = buildAutoRecord({
      draft: { id: 'd1', text, created_utc: now.toISOString() },
      wallets: [], lastWalletId: null, learned: {}, now,
    });
    const p = buildPayload(record, now)!;
    expect(p.due).toBe('2026-11-05T19:00:00+03:00');
    expect(p.title).toBe('позвонить маме — 19:00 МСК');
    expect(p.due_local).toBe(localOracle('2026-11-05T16:00:00Z'));
    if (process.env.TZ === 'America/New_York') expect(p.due_local).toBe('2026-11-05 11:00');
    if (process.env.TZ === 'UTC') expect(p.due_local).toBe('2026-11-05 16:00');
  });

  it('subscription: next occurrence, repeat monthly', () => {
    const p = buildPayload(
      rec({ kind: 'subscription', fields: { title: 'облако', day: 17, amount_minor: 30000 }, due_utc: '2026-01-01T09:00:00.000Z' }),
      NOW,
    );
    expect(p?.due).toBe('2026-11-17T12:00:00+03:00');
    expect(p?.repeat).toBe('monthly');
    expect(p?.due_msk).toBe('17.11 12:00 МСК');
    expect(p?.title).toBe('облако — 12:00 МСК');
    expect(p?.due_local).toBe(localOracle('2026-11-17T09:00:00Z'));
  });

  it('subscription without a day uses its stored time', () => {
    const p = buildPayload(rec({ kind: 'subscription', fields: { title: 'облако' } }), NOW);
    expect(p?.due).toBe('2026-10-23T19:00:00+03:00');
    expect(p?.repeat).toBe('monthly');
  });

  it('no due date, or a kind that is not a reminder: no payload', () => {
    expect(buildPayload(rec({ due_utc: null }), NOW)).toBeNull();
    expect(buildPayload(rec({ kind: 'subscription', fields: { title: 'x' }, due_utc: null }), NOW)).toBeNull();
    expect(buildPayload(rec({ kind: 'expense' }), NOW)).toBeNull();
    expect(buildPayload(rec({ kind: 'idea' }), NOW)).toBeNull();
  });

  it('invalid stored time: no payload', () => {
    expect(buildPayload(rec({ due_utc: 'nope' }), NOW)).toBeNull();
  });
});

describe('buildShortcutUrl', () => {
  const PREFIX = 'shortcuts://run-shortcut?name=' + encodeURIComponent('Мозг-напомнить') + '&input=text&text=';

  it('uses the configured Shortcut name', () => {
    expect(SHORTCUT_NAME).toBe('Мозг-напомнить');
    const url = buildShortcutUrl(buildPayload(rec({}), NOW)!);
    expect(url.startsWith(PREFIX)).toBe(true);
    expect(PREFIX).toBe('shortcuts://run-shortcut?name=%D0%9C%D0%BE%D0%B7%D0%B3-%D0%BD%D0%B0%D0%BF%D0%BE%D0%BC%D0%BD%D0%B8%D1%82%D1%8C&input=text&text=');
  });

  it('JSON parses back to the payload', () => {
    const p = buildPayload(rec({}), NOW)!;
    const url = buildShortcutUrl(p);
    expect(JSON.parse(decodeURIComponent(url.slice(PREFIX.length)))).toEqual(p);
  });

  it('the text part has no raw & + # quotes braces or spaces', () => {
    const url = buildShortcutUrl(buildPayload(rec({ fields: { title: 'a&b c+d%e#f' } }), NOW)!);
    const text = url.slice(PREFIX.length);
    expect(text).not.toMatch(/[&+#\s"{}]/);
    expect(text.replace(/%[0-9A-F]{2}/g, '')).not.toContain('%');
  });

  it.each([
    'позвонить маме',
    'скажи "привет" ёлке',
    'Tom & Jerry',
    '2+2=4',
    '100% готово',
    '#срочно',
    'тест 😀 эмодзи 👨‍👩‍👧',
    `all: "&+%# 'x' \\ \n tab\t`,
  ])('round-trips the title %j', (title) => {
    const p = buildPayload(rec({ fields: { title } }), NOW)!;
    const url = buildShortcutUrl(p);
    const text = url.slice(url.indexOf('&text=') + '&text='.length);
    const back = JSON.parse(decodeURIComponent(text));
    expect(back.title).toBe(`${title} — 19:00 МСК`);
    expect(back).toEqual(p);
  });
});

describe('stage 7: no reminder for money that already moved', () => {
  const wallets = [{ id: 'cash', name: 'Наличные', hidden: false, start_balance_minor: 0 }];
  const auto = (text: string): RecordRow =>
    buildAutoRecord({ draft: { id: 'd1', text, created_utc: NOW.toISOString() }, wallets, lastWalletId: null, learned: {}, now: NOW }).record;

  it('a debt, a return and a past-day expense give no payload (and no due time)', () => {
    for (const text of ['одолжил Пете 3000', 'Петя вернул мне 3000', 'вчера потратил 500 на такси']) {
      const r = auto(text);
      expect(['debt', 'repay', 'expense'], text).toContain(r.kind);
      expect(r.due_utc, text).toBeNull();
      expect(buildPayload(r, NOW), text).toBeNull();
    }
    expect(auto('вчера потратил 500 на такси').fields.happened_utc).toBe('2026-10-21T09:00:00.000Z');
    expect(buildPayload(rec({ kind: 'debt', fields: { who: 'Петя', amount_minor: 1, direction: 'to_me' } }), NOW)).toBeNull();
    expect(buildPayload(rec({ kind: 'repay', fields: { who: 'Петя', amount_minor: 1, direction: 'by_me' } }), NOW)).toBeNull();
  });
});
