// The second review of stage 7–8 (2026-10-26): everyday phrases read wrong.
import { describe, expect, it } from 'vitest';
import { DEFAULT_WALLETS } from '../src/config';
import { parse, parseMany } from '../src/parser/index';

const NOW = new Date('2026-10-22T09:00:00Z'); // Thursday 12:00 MSK
const p = (text: string) => parse(text, NOW, DEFAULT_WALLETS);
const many = (text: string) => parseMany(text, NOW, DEFAULT_WALLETS).map((r) => [r.kind, r.fields.amount_minor, r.fields.title]);

describe('a count before «за N» is not the money', () => {
  it.each([
    ['купил 2 пиццы за 1200', 120000, '2 пиццы'],
    ['купил 3 хлеба за 150', 15000, '3 хлеба'],
  ])('%s', (text, minor, title) => {
    expect(many(text)).toEqual([['expense', minor, title]]);
  });

  it('«заплатил 500 за 2 пиццы» keeps 500', () => {
    expect(p('заплатил 500 за 2 пиццы').fields.amount_minor).toBe(50000);
  });
});

describe('grams and other units are counts', () => {
  it.each(['200 грамм сахара', '500 граммов муки', '100 километров', '300 миллилитров воды'])('%s is not an expense', (text) => {
    expect(p(text).kind).not.toBe('expense');
  });
});

describe('a bare «в N» before a plural noun is not an hour in an expense title', () => {
  it('«потратил 500 в 5 магазинах»', () => {
    expect(p('потратил 500 в 5 магазинах').fields.title).toBe('5 магазинах');
  });
});

describe('«отдал няне 1500» is an expense', () => {
  it.each(['отдал няне 1500', 'отдала репетитору 2000'])('%s', (text) => {
    expect(p(text).kind).toBe('expense');
  });
});
