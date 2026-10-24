import { describe, expect, it } from 'vitest';
import { formatMsk, fromMskInput, mskClock, mskDayLabel, toMskInput } from '../src/time/format';

const NOW = new Date('2026-10-22T09:00:00Z');

describe('formatMsk', () => {
  it('big MSK time; no small line when the device is on MSK', () => {
    const t = formatMsk('2026-10-23T16:00:00.000Z', { deviceOffsetMin: 180, now: NOW });
    expect(t).toEqual({ big: '23.10 19:00 МСК', small: null });
  });

  it('small local time when the device zone differs', () => {
    // 16:00Z is 12:00 in New York in October (UTC-4 -> offset -240).
    const t = formatMsk('2026-10-23T16:00:00.000Z', { deviceOffsetMin: -240, now: NOW });
    expect(t.big).toBe('23.10 19:00 МСК');
    expect(t.small).toBe('у тебя 12:00');
  });

  it('adds the local date when the local day differs from the MSK day', () => {
    // 22:00 MSK on 23.10 is 03:00 on 24.10 at UTC+8.
    const t = formatMsk('2026-10-23T19:00:00.000Z', { deviceOffsetMin: 480, now: NOW });
    expect(t.big).toBe('23.10 22:00 МСК');
    expect(t.small).toBe('у тебя 24.10 03:00');
  });

  it('adds the year when it is not the current year; invalid input gives a dash', () => {
    expect(formatMsk('2027-01-05T09:00:00.000Z', { deviceOffsetMin: 180, now: NOW }).big).toBe('05.01.2027 12:00 МСК');
    expect(formatMsk('nope', { now: NOW })).toEqual({ big: '—', small: null });
  });

  it('uses the real device zone by default (works under any TZ)', () => {
    const iso = '2026-10-23T16:00:00.000Z';
    const t = formatMsk(iso, { now: NOW });
    expect(t.big).toBe('23.10 19:00 МСК');
    const off = -new Date(iso).getTimezoneOffset();
    expect(t.small === null).toBe(off === 180);
  });
});

describe('MSK helpers', () => {
  it('day labels and clock', () => {
    expect(mskDayLabel('2026-10-22T16:00:00.000Z', NOW)).toBe('сегодня');
    expect(mskDayLabel('2026-10-23T16:00:00.000Z', NOW)).toBe('завтра');
    expect(mskDayLabel('2026-10-27T16:00:00.000Z', NOW)).toBe('27.10');
    // 22:00Z on 22.10 is already 23.10 in Moscow.
    expect(mskDayLabel('2026-10-22T22:00:00.000Z', NOW)).toBe('завтра');
    expect(mskClock('2026-10-23T16:00:00.000Z')).toBe('19:00');
  });

  it('datetime-local value round-trips through MSK, independent of the device zone', () => {
    expect(toMskInput('2026-10-23T16:00:00.000Z')).toBe('2026-10-23T19:00');
    expect(fromMskInput('2026-10-23T19:00')).toBe('2026-10-23T16:00:00.000Z');
    expect(fromMskInput('')).toBeUndefined();
    expect(toMskInput(null)).toBe('');
  });
});
