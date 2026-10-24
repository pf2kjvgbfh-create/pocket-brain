import { describe, expect, it } from 'vitest';
import { SHORTCUT_NAME } from '../src/config';
import type { RecordRow } from '../src/db/types';
import { buildPayload, buildShortcutUrl } from '../src/shortcut/payload';

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
      title: 'позвонить маме',
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

  it('title falls back to the raw text', () => {
    expect(buildPayload(rec({ fields: {} }), NOW)?.title).toBe('напомни завтра в 19:00 позвонить маме');
    expect(buildPayload(rec({ fields: { title: '' } }), NOW)?.title).toBe('напомни завтра в 19:00 позвонить маме');
  });

  it('subscription: next occurrence, repeat monthly', () => {
    const p = buildPayload(
      rec({ kind: 'subscription', fields: { title: 'облако', day: 17, amount_minor: 30000 }, due_utc: '2026-01-01T09:00:00.000Z' }),
      NOW,
    );
    expect(p?.due).toBe('2026-11-17T12:00:00+03:00');
    expect(p?.repeat).toBe('monthly');
    expect(p?.due_msk).toBe('17.11 12:00 МСК');
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
    expect(back.title).toBe(title);
    expect(back).toEqual(p);
  });
});
