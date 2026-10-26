import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from '../src/parser/index';
import { DEFAULT_WALLETS } from '../src/config';

interface FixturePhrase {
  text: string;
  expected: Record<string, unknown> & { kind: string };
}
interface Fixture {
  now: string;
  phrases: FixturePhrase[];
}

const fixture: Fixture = JSON.parse(
  readFileSync(new URL('./fixtures/phrases.ru.json', import.meta.url), 'utf8'),
);
const NOW = new Date(fixture.now);

/** Pick from the parse result exactly the keys the fixture asserts. */
function actualFor(text: string, keys: string[], now = NOW): Record<string, unknown> {
  const r = parse(text, now, DEFAULT_WALLETS);
  const fields = r.fields as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k === 'kind') out[k] = r.kind;
    else if (k === 'tags') out[k] = r.tags;
    else out[k] = fields[k];
  }
  return out;
}

describe('fixture phrases.ru.json', () => {
  it('has exactly 50 phrases with the planned kind counts', () => {
    const counts: Record<string, number> = {};
    for (const p of fixture.phrases) counts[p.expected.kind] = (counts[p.expected.kind] ?? 0) + 1;
    expect(fixture.phrases).toHaveLength(50);
    expect(counts).toEqual({
      // Stage 7 (DECISIONS item 9): «… на вклад» is a deposit now, not a transfer to a «Вклад» wallet.
      reminder: 10, expense: 9, income: 4, transfer: 2,
      held: 6, deposit: 6, subscription: 6, idea: 7,
    });
  });

  for (const p of fixture.phrases) {
    it(p.text, () => {
      expect(actualFor(p.text, Object.keys(p.expected))).toEqual(p.expected);
    });
  }
});

describe('parser invariants', () => {
  it('returns raw_text unchanged for every phrase', () => {
    for (const p of fixture.phrases) {
      expect(parse(p.text, NOW, DEFAULT_WALLETS).raw_text).toBe(p.text);
    }
  });

  it('unknown text → idea with low confidence, text kept', () => {
    for (const text of ['что-то непонятное про вторник', 'надо бы разобраться с фотографиями', 'бла бла', '']) {
      const r = parse(text, NOW, DEFAULT_WALLETS);
      expect(r.kind).toBe('idea');
      expect(r.confidence).toBeLessThan(0.5);
      expect(r.raw_text).toBe(text);
    }
  });

  it('confidence is always within 0..1 and recognised kinds are confident', () => {
    for (const p of fixture.phrases) {
      const r = parse(p.text, NOW, DEFAULT_WALLETS);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
      if (p.expected.kind !== 'idea') expect(r.confidence).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('time without an hour defaults to 12:00 MSK, not the reference clock time', () => {
    const early = new Date('2026-10-22T05:17:00Z'); // 08:17 MSK
    expect(actualFor('напомни 1 ноября продлить страховку', ['due_utc'], early))
      .toEqual({ due_utc: '2026-11-01T09:00:00.000Z' });
    expect(actualFor('напомни завтра полить цветы', ['due_utc'], early))
      .toEqual({ due_utc: '2026-10-23T09:00:00.000Z' });
    expect(actualFor('напомни 17-го числа оплатить квартиру', ['due_utc'], early))
      .toEqual({ due_utc: '2026-11-17T09:00:00.000Z' });
  });

  it('«полтора часа» is 90 minutes, not 1 hour', () => {
    expect(actualFor('напомни через полтора часа позвонить', ['kind', 'title', 'due_utc']))
      .toEqual({ kind: 'reminder', title: 'позвонить', due_utc: '2026-10-22T10:30:00.000Z' });
  });

  it('a returned debt is income, not held money', () => {
    expect(actualFor('Иван отдал мне долг 2000', ['kind', 'amount_minor']))
      .toEqual({ kind: 'income', amount_minor: 200000 });
  });

  it('wallet alias stems do not swallow other words («кэшбэк» is not cash)', () => {
    expect(actualFor('кэшбэк 50 рублей', ['kind', 'wallet'])).toEqual({ kind: 'income', wallet: undefined });
  });

  it('matches against the passed wallet list (own name as alias), not the defaults', () => {
    const mine = [{ name: 'Сбер' }];
    expect(parse('купил кофе 200 рублей сбер', NOW, mine).fields.wallet).toBe('Сбер');
    expect(parse('купил кофе 200 рублей золотой картой', NOW, mine).fields.wallet).toBeUndefined();
  });

  it('spoken clock times «в семь тридцать» / «в два пятнадцать» are hh:mm, not a sum', () => {
    expect(actualFor('напомни завтра в семь тридцать позвонить', ['title', 'due_utc']))
      .toEqual({ title: 'позвонить', due_utc: '2026-10-23T04:30:00.000Z' });
    expect(actualFor('напомни завтра в два пятнадцать позвонить', ['title', 'due_utc']))
      .toEqual({ title: 'позвонить', due_utc: '2026-10-22T23:15:00.000Z' }); // literal 02:15 MSK, no AM/PM guess
    expect(actualFor('напомни завтра в девятнадцать сорок пять позвонить', ['title', 'due_utc']))
      .toEqual({ title: 'позвонить', due_utc: '2026-10-23T16:45:00.000Z' });
  });

  it('day of month rolls over month ends and keeps MSK across the UTC date line', () => {
    // 2026-10-31 23:30 MSK (20:30Z): today's 12:00 has passed → next month; Nov has 30 days → 30 Nov.
    const lateOct = new Date('2026-10-31T20:30:00Z');
    expect(actualFor('подписка музыка 199 рублей 31-го числа', ['day', 'due_utc'], lateOct))
      .toEqual({ day: 31, due_utc: '2026-11-30T09:00:00.000Z' });
    // 2026-10-21 22:30Z is already 22 Oct 01:30 MSK → "22-го" at 12:00 MSK is later today.
    const nightUtc = new Date('2026-10-21T22:30:00Z');
    expect(actualFor('подписка музыка 199 рублей 22-го числа', ['due_utc'], nightUtc))
      .toEqual({ due_utc: '2026-10-22T09:00:00.000Z' });
  });
});

describe('parser speed', () => {
  it('each phrase parses in under 50 ms (after warm-up)', () => {
    for (const p of fixture.phrases) parse(p.text, NOW, DEFAULT_WALLETS);
    let max = 0;
    let total = 0;
    for (const p of fixture.phrases) {
      const t0 = performance.now();
      parse(p.text, NOW, DEFAULT_WALLETS);
      const dt = performance.now() - t0;
      max = Math.max(max, dt);
      total += dt;
    }
    console.info(`parser timing: max ${max.toFixed(2)} ms, avg ${(total / fixture.phrases.length).toFixed(2)} ms`);
    expect(max).toBeLessThan(50);
  });
});
