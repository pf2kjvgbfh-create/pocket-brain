// Fixes after the stage-7 review (2026-10-26): each block reproduces one reported bug.
import { describe, expect, it } from 'vitest';
import { DEFAULT_WALLETS } from '../src/config';
import { parse, parseMany } from '../src/parser/index';
import { latestOnly } from '../src/refresh';

const MON_0430 = new Date('2026-10-26T01:30:00Z'); // Monday 26.10 04:30 MSK
const MON_1100 = new Date('2026-10-26T08:00:00Z'); // Monday 26.10 11:00 MSK
const NOON = new Date('2026-10-22T09:00:00Z'); // Thursday 12:00 MSK
const p = (text: string, now: Date = NOON) => parse(text, now, DEFAULT_WALLETS);

describe('review 2: a passed hour on the named weekday / date', () => {
  it('«в понедельник в 3 ночи» said on Monday 04:30 means next Monday, not tomorrow', () => {
    const r = p('напомни в понедельник в 3 ночи позвонить', MON_0430);
    expect(r.kind).toBe('reminder');
    expect(r.fields.due_utc).toBe('2026-11-02T00:00:00.000Z'); // Mon 02.11 03:00 MSK
  });

  it('«сегодня в 10 утра» / no day, said at 11:00: tomorrow', () => {
    expect(p('напомни сегодня в 10 утра позвонить', MON_1100).fields.due_utc).toBe('2026-10-27T07:00:00.000Z');
    expect(p('напомни в 10 утра позвонить', MON_1100).fields.due_utc).toBe('2026-10-27T07:00:00.000Z');
  });

  it('an explicit date that is today with a passed hour: next year (what chrono forwardDate does), not tomorrow', () => {
    expect(p('напомни 26 октября в 10 утра позвонить', MON_1100).fields.due_utc).toBe('2027-10-26T07:00:00.000Z');
  });
});

describe('review 3: «отдал <relation word> N» is not a return', () => {
  it.each(['отдал маме 3000', 'Отдал маме 3000', 'отдал брату 1500', 'отдала папе 2000'])('%s', (text) => {
    const r = p(text);
    expect(r.kind).toBe('expense');
    expect(r.fields.who).toBeUndefined();
  });

  it('a dictated name is still a return (fixtures)', () => {
    expect(p('Отдал Пете 1200').kind).toBe('repay');
    expect(p('отдал сергею 700').kind).toBe('repay');
    expect(p('отдал маме 3000 её деньги').kind).toBe('repay');
  });
});

describe('review 4: a unit word must be a whole word', () => {
  it.each([
    ['3000 метро', 300000],
    ['300 разное', 30000],
    ['1500 часы', 150000],
    ['5000 очки', 500000],
    ['5000 штраф', 500000],
    ['700 гречка', 70000],
  ])('%s is an expense', (text, minor) => {
    const r = p(text);
    expect(r.kind).toBe('expense');
    expect(r.fields.amount_minor).toBe(minor);
  });

  it('real counts stay thoughts', () => {
    expect(p('хочу прочитать 30 книг').kind).toBe('idea');
    expect(p('5 минут славы').kind).toBe('idea');
  });

  it('«2 магазинах» is a count, it does not break the split of two amounts', () => {
    const parts = parseMany('купил хлеб за 50 и молоко за 80 в 2 магазинах', NOON, DEFAULT_WALLETS);
    expect(parts.map((x) => x.fields.amount_minor)).toEqual([5000, 8000]);
  });
});

describe('review 9: the hour phrase is not part of an expense title', () => {
  it('«заплатил 5000 в 7 вечера за такси»', () => {
    const r = p('заплатил 5000 в 7 вечера за такси');
    expect(r.kind).toBe('expense');
    expect(r.fields.title).toBe('такси');
  });
});

describe('review 7: only the latest refresh applies', () => {
  it('an older refresh that finishes later is dropped, and its caller waits for the newest one', async () => {
    const applied: string[] = [];
    const delays: Record<string, number> = { old: 30, new: 1 };
    let call = 0;
    const refresh = latestOnly(
      async () => {
        const name = call === 0 ? 'old' : 'new';
        call += 1;
        await new Promise((r) => setTimeout(r, delays[name]));
        return name;
      },
      (data: string) => applied.push(data),
    );
    const first = refresh();
    const second = refresh();
    await Promise.all([first, second]);
    expect(applied).toEqual(['new']);
  });
});
