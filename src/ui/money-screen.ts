// «Деньги»: wallet balances, «Чужие деньги», deposits, subscriptions, recent operations.
import { RECENT_OPERATIONS } from '../config';
import { formatRub } from '../money/format';
import { computeTotals } from '../money/totals';
import type { WalletRow } from '../db/types';
import type { App } from './app';
import { h } from './dom';
import { listOf } from './rows';
import { openWalletEditor } from './wallet-editor';

function section(title: string, total: string | null, testId: string, ...body: HTMLElement[]): HTMLElement {
  return h(
    'section',
    { class: 'block', 'data-section': testId },
    h('div', { class: 'block-head' }, h('h2', {}, title), total ? h('span', { class: 'total', 'data-total': testId }, total) : null),
    ...body,
  );
}

function walletCard(app: App, w: WalletRow, balance: number): HTMLElement {
  const b = h(
    'button',
    { type: 'button', class: 'wallet-card', 'data-wallet-id': w.id },
    h('span', { class: 'wallet-name' }, w.name),
    h('span', { class: 'balance' }, formatRub(balance)),
  );
  b.addEventListener('click', () => openWalletEditor(app, w));
  return b;
}

export function renderMoney(app: App, root: HTMLElement): void {
  const totals = computeTotals(app.wallets, app.records);
  const visible = app.wallets.filter((w) => !w.hidden);
  const hidden = app.wallets.filter((w) => w.hidden);

  const add = h('button', { type: 'button', class: 'btn', 'data-action': 'wallet-add' }, 'Добавить кошелёк');
  add.addEventListener('click', () => openWalletEditor(app, null));

  const wallets = section(
    'Кошельки',
    `Всего ${formatRub(totals.walletsTotal)}`,
    'wallets',
    h('div', { class: 'wallet-grid' }, ...visible.map((w) => walletCard(app, w, totals.balances[w.id] ?? 0))),
    add,
  );
  const hiddenBlock =
    hidden.length > 0
      ? section('Скрытые кошельки', null, 'hidden', h('div', { class: 'wallet-grid' }, ...hidden.map((w) => walletCard(app, w, totals.balances[w.id] ?? 0))))
      : null;

  const byNewest = (a: { created_utc: string }, b: { created_utc: string }): number => (a.created_utc < b.created_utc ? 1 : -1);
  const held = section('Чужие деньги', formatRub(totals.held.total), 'held', listOf(app, [...totals.held.items].sort(byNewest), {}, 'Пока нет.'));
  const deposits = section('Вклады', formatRub(totals.deposits.total), 'deposits', listOf(app, [...totals.deposits.items].sort(byNewest), {}, 'Пока нет.'));
  const subs = section(
    'Подписки',
    `${formatRub(totals.subscriptions.monthlyTotal)} в месяц`,
    'subscriptions',
    listOf(app, [...totals.subscriptions.items].sort(byNewest), { showTime: 'due' }, 'Пока нет.'),
  );
  const ops = app.records
    .filter((r) => r.kind === 'income' || r.kind === 'expense' || r.kind === 'transfer')
    .sort(byNewest)
    .slice(0, RECENT_OPERATIONS);
  const recent = section('Последние операции', null, 'operations', listOf(app, ops, { showTime: 'created' }, 'Пока нет.'));

  root.replaceChildren(h('h1', {}, 'Деньги'), wallets, ...(hiddenBlock ? [hiddenBlock] : []), held, deposits, subs, recent);
}
