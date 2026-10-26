import { describe, expect, it } from 'vitest';
import { formatMoneyShort, formatRub, parseRubles } from '../src/money/format';

describe('formatRub', () => {
  it('formats kopecks as «1 234,50 ₽» with fixed non-breaking separators', () => {
    expect(formatRub(123450)).toBe('1 234,50 ₽');
    expect(formatRub(50000)).toBe('500,00 ₽');
    expect(formatRub(0)).toBe('0,00 ₽');
    expect(formatRub(5)).toBe('0,05 ₽');
    expect(formatRub(123456789)).toBe('1 234 567,89 ₽');
  });
  it('shows a minus for negatives', () => {
    expect(formatRub(-123450)).toBe('-1 234,50 ₽');
  });
});

describe('formatMoneyShort', () => {
  it('drops «,00» for whole rubles, keeps kopecks and the currency sign', () => {
    expect(formatMoneyShort(125000)).toBe('1 250 ₽');
    expect(formatMoneyShort(8950)).toBe('89,50 ₽');
    expect(formatMoneyShort(10000, 'USD')).toBe('100 $');
    expect(formatMoneyShort(2050, 'EUR')).toBe('20,50 €');
  });
});

describe('parseRubles', () => {
  it('parses to integer kopecks without float errors', () => {
    expect(parseRubles('500')).toBe(50000);
    expect(parseRubles('1 234,50')).toBe(123450);
    expect(parseRubles('1 234.5')).toBe(123450);
    expect(parseRubles('0,07')).toBe(7);
    expect(parseRubles('19,99')).toBe(1999);
    expect(parseRubles('1,005')).toBeUndefined();
  });
  it('returns undefined for empty or invalid input', () => {
    expect(parseRubles('')).toBeUndefined();
    expect(parseRubles('abc')).toBeUndefined();
    expect(parseRubles('-5')).toBeUndefined();
  });
});
