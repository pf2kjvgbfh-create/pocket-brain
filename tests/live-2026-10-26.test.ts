// The Architect's live check (2026-10-26 20:10Z, WebKit iPhone, New York zone): four phrases read wrong.
import { describe, expect, it } from 'vitest';
import { DEFAULT_WALLETS } from '../src/config';
import type { DraftRow, WalletRow } from '../src/db/types';
import { parse } from '../src/parser/index';
import { buildAutoRecords } from '../src/ui/autosave';

const NOW = new Date('2026-10-26T20:10:00Z'); // Mon 23:10 MSK
const p = (text: string) => parse(text, NOW, DEFAULT_WALLETS);
const wallets: WalletRow[] = DEFAULT_WALLETS.map((w) => ({ id: w.id, name: w.name, hidden: false, start_balance_minor: 0 }));
const draft = (text: string): DraftRow => ({ id: 'd1', text, created_utc: NOW.toISOString() });
const auto = (text: string, lastWalletId: string | null = 'gold', list: WalletRow[] = wallets) =>
  buildAutoRecords({ draft: draft(text), wallets: list, lastWalletId, learned: {}, now: NOW });

describe('1. «в половине пятого»', () => {
  it('= 16:30 MSK (tomorrow, 23:10 now), title without the time', () => {
    const r = p('напомни в половине пятого забрать посылку');
    expect(r.kind).toBe('reminder');
    expect(r.fields.due_utc).toBe('2026-10-27T13:30:00.000Z');
    expect(r.fields.title).toBe('забрать посылку');
  });

  it('«половина пятого утра» = 04:30', () => {
    expect(p('напомни в половине пятого утра забрать посылку').fields.due_utc).toBe('2026-10-27T01:30:00.000Z');
    expect(p('напомни половина пятого ночи забрать посылку').fields.due_utc).toBe('2026-10-27T01:30:00.000Z');
  });
});

describe('2. «перевёл 10к на сбер»', () => {
  it('a transfer to the named wallet, from the last wallet', () => {
    const r = p('перевёл 10к на золотую');
    expect(r.kind).toBe('transfer');
    expect(r.fields.to_wallet).toBe('Золотая карта');
    const rec = auto('перевёл 10к на золотую', 'silver').records[0];
    expect([rec.kind, rec.wallet_id, rec.fields.to_wallet_id, rec.fields.amount_minor]).toEqual(['transfer', 'silver', 'gold', 1000000]);
  });

  it('the last wallet is the target itself: from cash', () => {
    const rec = auto('перевёл 10к на золотую', 'gold').records[0];
    expect([rec.wallet_id, rec.fields.to_wallet_id]).toEqual(['cash', 'gold']);
  });

  it('a bank with no wallet yet: the wallet «Сбер» is created and is the target', () => {
    expect(p('перевёл 10к на сбер').kind).toBe('transfer');
    const { records, newWallets } = auto('перевёл 10к на сбер', 'gold');
    expect(newWallets.map((w) => [w.name, w.hidden, w.start_balance_minor])).toEqual([['Сбер', false, 0]]);
    expect([records[0].kind, records[0].wallet_id, records[0].fields.to_wallet_id, records[0].fields.amount_minor]).toEqual([
      'transfer', 'gold', newWallets[0].id, 1000000,
    ]);
  });

  it('a wallet «Сбер» that exists is reused, nothing created', () => {
    const list = [...wallets, { id: 'sber', name: 'Сбер', hidden: false, start_balance_minor: 0 }];
    const { records, newWallets } = auto('перевёл 10к на сбер', 'gold', list);
    expect(newWallets).toEqual([]);
    expect(records[0].fields.to_wallet_id).toBe('sber');
  });

  it('not a bank, not a wallet: no transfer, no wallet', () => {
    expect(p('перевёл 500 на телефон').kind).not.toBe('transfer');
    expect(auto('перевёл 500 на телефон').newWallets).toEqual([]);
  });
});

describe('3. «потратил … на подписку» is an expense', () => {
  it('20 $ expense «подписка»', () => {
    const r = p('потратил 20 долларов на подписку');
    expect(r.kind).toBe('expense');
    expect(r.fields.amount_minor).toBe(2000);
    expect(r.fields.currency).toBe('USD');
    expect(r.fields.title).toBe('подписка');
  });

  it.each(['купил подписку за 299', 'заплатил за подписку 299', 'оплатил подписку 299'])('%s → expense', (text) => {
    expect(p(text).kind).toBe('expense');
  });

  it('a monthly marker keeps it a subscription', () => {
    expect(p('оплачиваю подписку 299 каждый месяц').kind).toBe('subscription');
    expect(p('плачу 299 в месяц за музыку').kind).toBe('subscription');
    expect(p('подписка на облако 149 рублей 1-го числа').kind).toBe('subscription');
  });
});

describe('4. income says what it was', () => {
  it.each([
    ['получил зарплату 120000', 'зарплата', 12000000],
    ['пришла зарплата 85 000 на тинькофф', 'зарплата', 8500000],
    ['получил аванс 30000', 'аванс', 3000000],
    ['дали премию 10000', 'премия', 1000000],
  ])('%s → «%s»', (text, title, minor) => {
    const r = p(text);
    expect(r.kind).toBe('income');
    expect(r.fields.title).toBe(title);
    expect(r.fields.amount_minor).toBe(minor);
  });
});
