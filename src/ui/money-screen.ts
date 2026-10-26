// «Деньги»: wallet balances, recent operations (right after the wallets, stage 7 B3), «Долги и чужие деньги» (one
// line per person), deposits, subscriptions. A tap on any row opens the editor.
import { RECENT_OPERATIONS } from '../config';
import { formatRub } from '../money/format';
import { computeTotals, recordWhen, type PersonDebt, type Totals } from '../money/totals';
import type { RecordRow, WalletRow } from '../db/types';
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

const byNewest = (a: RecordRow, b: RecordRow): number => (recordWhen(a) < recordWhen(b) ? 1 : -1);

/** How many «Последние операции» are shown; «Показать ещё» adds RECENT_OPERATIONS (kept until the page is reloaded). */
let opsShown = RECENT_OPERATIONS;

function netText(net: number): string {
  if (net > 0) return `должен мне ${formatRub(net)}`;
  if (net < 0) return `я должен / храню ${formatRub(-net)}`;
  return 'в расчёте';
}

function personBlock(app: App, p: PersonDebt): HTMLElement {
  return h(
    'div',
    { class: 'person', 'data-person': p.key },
    h(
      'div',
      { class: 'person-head' },
      h('h3', {}, p.who),
      h('span', { class: `net ${p.net > 0 ? 'plus' : p.net < 0 ? 'minus' : ''}`, 'data-net': String(p.net) }, netText(p.net)),
    ),
    listOf(app, [...p.items].sort(byNewest), { showTime: 'created', inPerson: true }, ''),
  );
}

/** DECISIONS stage 7, item 3: one net per person (+ they owe me, − I owe / keep their money) and two totals. */
function debtsSection(app: App, debts: Totals['debts']): HTMLElement {
  const newest = (p: PersonDebt): string => recordWhen(p.items[p.items.length - 1]);
  const people = [...debts.people].sort((a, b) => (newest(a) < newest(b) ? 1 : -1));
  return h(
    'section',
    { class: 'block', 'data-section': 'debts' },
    h('div', { class: 'block-head' }, h('h2', {}, 'Долги и чужие деньги')),
    h(
      'div',
      { class: 'debt-totals' },
      h('p', {}, h('span', { class: 'lbl' }, 'Мне должны'), h('span', { class: 'total plus', 'data-total': 'owed-to-me' }, formatRub(debts.owedToMe))),
      h('p', {}, h('span', { class: 'lbl' }, 'Я должен / храню'), h('span', { class: 'total minus', 'data-total': 'i-owe' }, formatRub(debts.iOwe))),
    ),
    ...(people.length ? people.map((p) => personBlock(app, p)) : [h('p', { class: 'hint empty' }, 'Пока нет.')]),
  );
}

/** Records that move a wallet («Последние операции»); a debt that is only a fact has no wallet and is not listed. */
const isOperation = (r: RecordRow): boolean =>
  r.kind === 'income' || r.kind === 'expense' || r.kind === 'transfer' ||
  ((r.kind === 'deposit' || r.kind === 'debt' || r.kind === 'repay') && r.wallet_id !== null);

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

  const debts = debtsSection(app, totals.debts);
  const deposits = section('Вклады', formatRub(totals.deposits.total), 'deposits', listOf(app, [...totals.deposits.items].sort(byNewest), {}, 'Пока нет.'));
  const subs = section(
    'Подписки',
    `${formatRub(totals.subscriptions.monthlyTotal)} в месяц`,
    'subscriptions',
    listOf(app, [...totals.subscriptions.items].sort(byNewest), { showTime: 'due' }, 'Пока нет.'),
  );
  const allOps = app.records.filter(isOperation).sort(byNewest);
  const recent = section('Последние операции', null, 'operations', listOf(app, allOps.slice(0, opsShown), { showTime: 'created' }, 'Пока нет.'));
  if (allOps.length > opsShown) {
    const more = h('button', { type: 'button', class: 'btn', 'data-action': 'ops-more' }, `Показать ещё (${allOps.length - opsShown})`);
    more.addEventListener('click', () => {
      opsShown += RECENT_OPERATIONS;
      renderMoney(app, root);
    });
    recent.append(more);
  }

  root.replaceChildren(h('h1', {}, 'Деньги'), wallets, ...(hiddenBlock ? [hiddenBlock] : []), recent, debts, deposits, subs);
}
