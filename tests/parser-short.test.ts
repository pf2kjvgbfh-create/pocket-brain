// Short everyday phrases the stage-1 rules missed (tests/fixtures/unsure.ru.json): «такси 650», «завтра днём …».
// Stage 5 adds rules for them, so they work instantly and without the local model.
import { describe, expect, it } from 'vitest';
import { DEFAULT_WALLETS } from '../src/config';
import { needsModel } from '../src/parser/confidence';
import { parse } from '../src/parser/index';

const NOW = new Date('2026-10-22T09:00:00Z'); // Thursday 12:00 MSK
const p = (text: string) => parse(text, NOW, DEFAULT_WALLETS);

describe('a bare amount after a few words is an expense', () => {
  it.each([
    ['кофе с собой триста пятьдесят', 35000, 'кофе с собой'],
    ['обед в столовой 420', 42000, 'обед в столовой'],
    ['такси до дома 650', 65000, 'такси до дома'],
    ['заправка 2500', 250000, 'заправка'],
    ['стрижка 1200', 120000, 'стрижка'],
    ['продуктов на 3400', 340000, 'продуктов'],
    ['цветы 900', 90000, 'цветы'],
    ['бензин тысяча восемьсот', 180000, 'бензин'],
  ])('%s', (text, amount, title) => {
    const r = p(text);
    expect(r.kind).toBe('expense');
    expect(r.fields.amount_minor).toBe(amount);
    expect(r.fields.title).toBe(title);
    expect(needsModel(r)).toBe(false);
  });

  it('a long sentence with a number stays a thought (the model may look at it)', () => {
    expect(p('репетитор по английскому 2000 за урок').kind).not.toBe('income');
    expect(p('хочу прочитать 30 книг за год').kind).toBe('idea');
  });
});

describe('income verbs: sold, earned on the side', () => {
  it.each([
    ['продал велосипед за 15000', 1500000],
    ['подработка принесла 7000', 700000],
    ['сдал металлолом 1500', 150000],
  ])('%s', (text, amount) => {
    const r = p(text);
    expect(r.kind).toBe('income');
    expect(r.fields.amount_minor).toBe(amount);
  });
});

describe('a day word with a part of the day is a reminder', () => {
  it.each([
    // Saturday 2026-10-24 09:00 MSK = 06:00Z
    ['в субботу утром отвезти машину на сервис', '2026-10-24T06:00:00.000Z', 'отвезти машину на сервис'],
    // 2026-10-24 09:00 MSK
    ['к врачу послезавтра к девяти', '2026-10-24T06:00:00.000Z', 'к врачу'],
    // today 19:00 MSK = 16:00Z
    ['вечером забрать ребёнка из садика', '2026-10-22T16:00:00.000Z', 'забрать ребёнка из садика'],
    // tomorrow 13:00 MSK = 10:00Z
    ['завтра днём оплатить штраф', '2026-10-23T10:00:00.000Z', 'оплатить штраф'],
  ])('%s', (text, due, title) => {
    const r = p(text);
    expect(r.kind).toBe('reminder');
    expect(r.fields.due_utc).toBe(due);
    expect(r.fields.title).toBe(title);
  });

  it('a bare weekday or «завтра» without a part of the day is still not a reminder', () => {
    expect(p('что-то непонятное про вторник').kind).toBe('idea');
    expect(p('завтра будет дождь').kind).toBe('idea');
  });

  it('a past evening is not a reminder; «утром» after its hour moves to tomorrow', () => {
    expect(p('вчера вечером ходили в кино').kind).toBe('idea');
    const r = parse('утром полить цветы', new Date('2026-10-22T15:00:00Z'), DEFAULT_WALLETS);
    expect(r.fields.due_utc).toBe('2026-10-23T06:00:00.000Z');
  });
});

describe('savings account at a rate is a deposit', () => {
  it('положил на накопительный счёт 20000 под 16 процентов', () => {
    const r = p('положил на накопительный счёт 20000 под 16 процентов');
    expect(r.kind).toBe('deposit');
    expect(r.fields.amount_minor).toBe(2000000);
    expect(r.fields.rate).toBe(16);
  });
});

describe('wishes stay thoughts', () => {
  it.each(['маме на день рождения цветы', 'хочу научиться играть на гитаре', 'интересно попробовать бегать по утрам', 'хорошо бы съездить летом на Байкал'])(
    '%s',
    (text) => expect(p(text).kind).toBe('idea'),
  );
});

describe('a bare time unit is not a date («ремонт часов», «месяц отпуска»)', () => {
  it.each([
    ['мастеру за ремонт часов 2700', 'idea'],
    ['ремонт часов 2700', 'expense'],
    ['месяц отпуска в горах', 'idea'],
    ['пять минут славы', 'idea'],
  ])('%s → %s', (text, kind) => expect(p(text).kind).toBe(kind));

  it('«через час» and «через 10 минут» are still reminders', () => {
    expect(p('через час выключить духовку')).toMatchObject({ kind: 'reminder', fields: { due_utc: '2026-10-22T10:00:00.000Z' } });
    expect(p('через 10 минут проверить чайник').fields.due_utc).toBe('2026-10-22T09:10:00.000Z');
  });
});
