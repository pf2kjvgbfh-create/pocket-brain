import { describe, expect, it } from 'vitest';
import { DEFAULT_WALLETS } from '../src/config';
import { needsModel } from '../src/parser/confidence';
import { parse } from '../src/parser/index';
import fixtures from './fixtures/phrases.ru.json';

const NOW = new Date(fixtures.now);
const check = (text: string): boolean => needsModel(parse(text, NOW, DEFAULT_WALLETS));

describe('needsModel', () => {
  it('rules fell back to a low-confidence idea: unsure', () => {
    expect(check('что-то непонятное про вторник')).toBe(true);
    expect(check('надо бы разобраться с фотографиями')).toBe(true);
    expect(check('потратил на такси')).toBe(true);
    expect(check('заплатил за обед')).toBe(true);
  });

  it('a money kind without an amount: unsure', () => {
    expect(check('подписка на облако')).toBe(true);
    expect(check('поставь вклад')).toBe(true);
  });

  it('a reminder without a time: unsure', () => {
    expect(check('напомни позвонить маме')).toBe(true);
    expect(check('напомни')).toBe(true);
  });

  it('an idea with tags (confidence 0.6) is fine', () => {
    expect(check('хорошая книга про привычки теги: чтение, саморазвитие')).toBe(false);
  });

  it('every reference phrase except the two fallback ideas is confident', () => {
    const unsure = new Set(['что-то непонятное про вторник', 'надо бы разобраться с фотографиями']);
    for (const p of fixtures.phrases) expect(check(p.text), p.text).toBe(unsure.has(p.text));
  });
});
