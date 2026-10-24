// Add / rename / hide / set start balance of a wallet, in a sheet.
import { checkWalletName } from '../db/wallets';
import type { WalletRow } from '../db/types';
import { minorToInput, parseRubles } from '../money/format';
import { openSheet, type App, type Sheet } from './app';
import { h } from './dom';
import { newId } from './intake';

export function openWalletEditor(app: App, wallet: WalletRow | null): void {
  let sheet: Sheet | undefined;
  const name = h('input', { type: 'text', 'data-field': 'wallet-name', autocomplete: 'off' });
  name.value = wallet?.name ?? '';
  const start = h('input', { type: 'text', 'data-field': 'wallet-start', inputmode: 'decimal', autocomplete: 'off' });
  start.value = wallet ? minorToInput(wallet.start_balance_minor) : '';
  const error = h('p', { class: 'error', role: 'alert' });

  const persist = async (row: WalletRow): Promise<void> => {
    await app.db.putWallet(row);
    sheet?.close();
    await app.refresh();
  };

  const save = h('button', { type: 'button', class: 'btn primary', 'data-action': 'wallet-save' }, wallet ? 'Сохранить' : 'Добавить');
  save.addEventListener('click', () => {
    const check = checkWalletName(app.wallets, name.value, wallet?.id);
    if (!check.ok) {
      error.textContent = check.reason;
      return;
    }
    const balance = start.value.trim() === '' ? 0 : parseRubles(start.value);
    if (balance === undefined) {
      error.textContent = 'Сумма: только цифры, например 1500 или 1500,50';
      return;
    }
    void persist({ id: wallet?.id ?? newId(), name: check.name, hidden: wallet?.hidden ?? false, start_balance_minor: balance });
  });

  const cancel = h('button', { type: 'button', class: 'btn', 'data-action': 'wallet-cancel' }, 'Отмена');
  cancel.addEventListener('click', () => sheet?.close());

  const actions = h('div', { class: 'actions' }, save, cancel);
  if (wallet) {
    const toggle = h('button', { type: 'button', class: 'btn', 'data-action': 'wallet-toggle-hidden' }, wallet.hidden ? 'Показать' : 'Скрыть');
    toggle.addEventListener('click', () => void persist({ ...wallet, hidden: !wallet.hidden }));
    actions.append(toggle);
  }

  const body = h(
    'section',
    { class: 'card', 'data-testid': 'wallet-editor' },
    h('h2', {}, wallet ? 'Кошелёк' : 'Новый кошелёк'),
    h('label', { class: 'row-field' }, h('span', { class: 'lbl' }, 'Название'), name),
    h('label', { class: 'row-field' }, h('span', { class: 'lbl' }, 'Начальный остаток, ₽'), start),
    error,
    actions,
  );
  sheet = openSheet(body);
}
