// The toast and «Последняя запись» say WHAT was saved (stage 7, B1). Device zone passed explicitly (pnpm test:tz).
import { describe, expect, it } from 'vitest';
import { DEFAULT_WALLETS } from '../src/config';
import type { RecordRow, WalletRow } from '../src/db/types';
import { alreadyText, recordSentence, savedText } from '../src/ui/saved-text';

const NOW = new Date('2026-10-22T09:00:00Z'); // Thursday 12:00 MSK
const wallets: WalletRow[] = DEFAULT_WALLETS.map((w) => ({ id: w.id, name: w.name, hidden: false, start_balance_minor: 0 }));
const MSK = { now: NOW, deviceOffsetMin: 180 };
const NY = { now: NOW, deviceOffsetMin: -240 };
/** Spaces of every kind -> one plain space (money uses non-breaking ones). */
const plain = (s: string): string => s.replace(/[\s ]+/g, ' ');

function rec(over: Partial<RecordRow>): RecordRow {
  return {
    id: 'r', kind: 'idea', raw_text: 'текст', fields: {}, wallet_id: null, due_utc: null,
    created_utc: NOW.toISOString(), updated_utc: NOW.toISOString(), deleted: false, ...over,
  };
}
const say = (r: Partial<RecordRow>, opts = MSK): string => plain(recordSentence(rec(r), wallets, opts));

describe('recordSentence', () => {
  it('expense: what — how much, which wallet; whole rubles without «,00»', () => {
    expect(say({ kind: 'expense', wallet_id: 'cash', fields: { title: 'продукты', amount_minor: 125000 } })).toBe('Записал: продукты — 1 250 ₽, Наличные');
    expect(say({ kind: 'expense', wallet_id: 'gold', fields: { amount_minor: 8950 } })).toBe('Записал: трата — 89,50 ₽, Золотая карта');
  });

  it('a past day and a foreign currency are said', () => {
    expect(say({ kind: 'expense', wallet_id: 'cash', fields: { title: 'цветы', amount_minor: 200000, happened_utc: '2026-10-21T12:00:00.000Z' } }))
      .toBe('Записал: цветы — 2 000 ₽, Наличные (21.10)');
    expect(say({ kind: 'expense', wallet_id: 'cash', fields: { title: 'сувениры', amount_minor: 10000, currency: 'USD' } }))
      .toBe('Записал: сувениры — 100 $, Наличные — в рублях не считается');
  });

  it('reminder: always the full MSK date; the device time only when the zone differs', () => {
    const r = { kind: 'reminder' as const, fields: { title: 'позвонить врачу' }, due_utc: '2026-10-27T06:00:00.000Z' };
    expect(say(r)).toBe('Напомню: позвонить врачу — 27.10 09:00 МСК');
    expect(say(r, NY)).toBe('Напомню: позвонить врачу — 27.10 09:00 МСК (у тебя 02:00)');
    const tomorrow = { ...r, due_utc: '2026-10-23T16:00:00.000Z' };
    expect(say(tomorrow)).toBe('Напомню: позвонить врачу — 23.10 19:00 МСК'); // never just «завтра»
  });

  it('reminder without an hour says so', () => {
    const r = { kind: 'reminder' as const, fields: { title: 'оплатить свет', no_time: true }, due_utc: '2026-10-25T09:00:00.000Z' };
    expect(say(r)).toBe('Напомню: оплатить свет — 25.10 12:00 МСК (время не названо)');
    expect(say(r, NY)).toBe('Напомню: оплатить свет — 25.10 12:00 МСК (время не названо; у тебя 05:00)');
  });

  it('a thought: the first 40 characters; a phrase the rules did not understand says so', () => {
    expect(say({ kind: 'idea', fields: { title: 'купить удочку' } })).toBe('Мысль: купить удочку');
    const long = 'очень длинная мысль про то, как устроить огород на даче весной';
    expect(say({ kind: 'idea', fields: { title: long } })).toBe(`Мысль: ${long.slice(0, 40)}…`);
    expect(say({ kind: 'idea', refine: 'pending', fields: { title: 'что-то непонятное' } })).toBe('Не понял — записал в мысли: что-то непонятное');
  });

  it('debts and returns: who, how much, and whether a wallet changed', () => {
    expect(say({ kind: 'debt', wallet_id: 'cash', fields: { who: 'Петя', amount_minor: 300000, direction: 'to_me' } })).toBe('Дал в долг: Петя — 3 000 ₽, с «Наличные»');
    expect(say({ kind: 'debt', fields: { who: 'Маша', amount_minor: 150000, direction: 'to_me' } })).toBe('Мне должны: Маша — 1 500 ₽');
    expect(say({ kind: 'debt', wallet_id: 'cash', fields: { who: 'Петя', amount_minor: 200000, direction: 'from_me' } })).toBe('Взял в долг: Петя — 2 000 ₽, на «Наличные»');
    expect(say({ kind: 'debt', fields: { who: 'Оля', amount_minor: 50000, direction: 'from_me' } })).toBe('Я должен: Оля — 500 ₽');
    expect(say({ kind: 'repay', wallet_id: 'cash', fields: { who: 'Иван', amount_minor: 200000, direction: 'by_me' } })).toBe('Вернул долг: Иван — 2 000 ₽, с «Наличные»');
    expect(say({ kind: 'repay', wallet_id: 'gold', fields: { who: 'Петя', amount_minor: 100000, direction: 'to_me' } })).toBe('Мне вернули: Петя — 1 000 ₽, на «Золотая карта»');
  });

  it('income, transfer, deposit, kept money, subscription', () => {
    expect(say({ kind: 'income', wallet_id: 'tinkoff', fields: { title: 'зарплата', amount_minor: 8_500_000 } })).toBe('Доход: зарплата — 85 000 ₽, Тинькофф');
    expect(say({ kind: 'transfer', wallet_id: 'gold', fields: { amount_minor: 500000, to_wallet_id: 'cash' } })).toBe('Перевод: 5 000 ₽, Золотая карта → Наличные');
    expect(say({ kind: 'deposit', wallet_id: 'tinkoff', fields: { amount_minor: 5_000_000, rate: 7, term_months: 6 } }))
      .toBe('Вклад: 50 000 ₽ — с «Тинькофф», 7%, до 22.04.2027');
    expect(say({ kind: 'held', fields: { who: 'Иван', amount_minor: 300000, rate: 6.5 } })).toBe('Чужие деньги: Иван — 3 000 ₽, 6,5%');
    expect(say({ kind: 'subscription', wallet_id: 'cash', fields: { title: 'нетфликс', amount_minor: 79900, day: 5 } }))
      .toBe('Подписка: нетфликс — 799 ₽ в месяц, следующий платёж 05.11');
  });
});

describe('savedText / alreadyText', () => {
  it('one record = its sentence; several are listed compactly', () => {
    const a = rec({ id: 'a', kind: 'expense', wallet_id: 'cash', fields: { title: 'кофе', amount_minor: 30000 } });
    const b = rec({ id: 'b', kind: 'expense', wallet_id: 'cash', fields: { title: 'круассан', amount_minor: 25000 } });
    expect(plain(savedText([a], wallets, MSK))).toBe('Записал: кофе — 300 ₽, Наличные');
    expect(plain(savedText([a, b], wallets, MSK))).toBe('Записал 2 записи: кофе — 300 ₽; круассан — 250 ₽ (Наличные)');
    const c = { ...b, id: 'c', wallet_id: 'gold' };
    expect(plain(savedText([a, c, { ...b, id: 'd' }, { ...b, id: 'e' }, { ...b, id: 'f' }], wallets, MSK)))
      .toBe('Записал 5 записей: кофе — 300 ₽, Наличные; круассан — 250 ₽, Золотая карта; круассан — 250 ₽, Наличные; круассан — 250 ₽, Наличные; круассан — 250 ₽, Наличные');
  });

  it('the same link again', () => {
    const r = rec({ kind: 'reminder', fields: { title: 'позвонить маме' }, due_utc: '2026-10-23T16:00:00.000Z' });
    expect(plain(alreadyText(r, wallets, MSK))).toBe('Уже записано, второй раз не сохраняю. Напомню: позвонить маме — 23.10 19:00 МСК');
  });
});
