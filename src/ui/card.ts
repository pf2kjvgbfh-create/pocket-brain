// The card «Понял так»: shown instantly from the rules parser, every field editable, «Сохранить» always enabled.
import type { RecordRow, WalletRow } from '../db/types';
import { fromMskInput } from '../time/format';
import { KINDS, KIND_FIELDS, KIND_LABEL, recordFromState, understoodSentence, type CardState, type FieldName } from './card-model';
import type { Kind } from '../db/types';
import { h, timeEl } from './dom';

export interface CardOptions {
  state: CardState;
  wallets: WalletRow[];
  now: () => Date;
  /** Banner above the sentence, e.g. «Уже сохранено». */
  notice?: string;
  /** Existing record: shows «Удалить» (with an in-page confirm). */
  editing: boolean;
  onSave: (record: RecordRow) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

const LABELS: Record<FieldName, string> = {
  title: 'Что',
  amount: 'Сумма, ₽',
  wallet: 'Кошелёк',
  toWallet: 'Куда (кошелёк)',
  due: 'Когда (МСК)',
  who: 'Чьи деньги',
  rate: 'Ставка, %',
  term: 'Срок, месяцев',
  day: 'День месяца',
  tags: 'Теги',
};

function row(label: string, control: HTMLElement): HTMLElement {
  return h('label', { class: 'row-field' }, h('span', { class: 'lbl' }, label), control);
}

function walletSelect(s: CardState, key: 'walletId' | 'toWalletId', wallets: WalletRow[], onChange: () => void): HTMLSelectElement {
  const sel = h('select', { 'data-field': key === 'walletId' ? 'wallet' : 'toWallet' });
  sel.append(h('option', { value: '' }, '— без кошелька'));
  // Visible wallets only; a hidden wallet appears only when this very record already uses it (so editing never drops it).
  for (const w of wallets) {
    if (!w.hidden || w.id === s[key]) sel.append(h('option', { value: w.id }, w.hidden ? `${w.name} (скрыт)` : w.name));
  }
  sel.value = s[key];
  sel.addEventListener('change', () => {
    s[key] = sel.value;
    onChange();
  });
  return sel;
}

function textInput(s: CardState, key: keyof CardState & string, field: FieldName, onChange: () => void, extra: Record<string, string> = {}): HTMLInputElement {
  const input = h('input', { type: 'text', 'data-field': field, autocomplete: 'off', ...extra });
  input.value = String(s[key] ?? '');
  input.addEventListener('input', () => {
    (s as unknown as Record<string, string>)[key] = input.value;
    onChange();
  });
  return input;
}

export function renderCard(opts: CardOptions): HTMLElement {
  const { state, wallets } = opts;
  const sentence = h('p', { class: 'sentence', 'data-testid': 'sentence' });
  const fieldsBox = h('div', { class: 'fields' });
  const refreshSentence = (): void => {
    sentence.textContent = understoodSentence(state, wallets, opts.now());
  };

  const whenLine = h('div', { class: 'when' });
  const refreshWhen = (): void => {
    whenLine.replaceChildren(timeEl(fromMskInput(state.due) ?? null, opts.now()));
  };

  const control = (name: FieldName): HTMLElement => {
    const changed = (): void => {
      refreshSentence();
      if (name === 'due') refreshWhen();
    };
    switch (name) {
      case 'title':
        return textInput(state, 'title', 'title', changed);
      case 'amount':
        return textInput(state, 'amount', 'amount', changed, { inputmode: 'decimal' });
      case 'wallet':
        return walletSelect(state, 'walletId', wallets, changed);
      case 'toWallet':
        return walletSelect(state, 'toWalletId', wallets, changed);
      case 'due': {
        const input = h('input', { type: 'datetime-local', 'data-field': 'due' });
        input.value = state.due;
        input.addEventListener('input', () => {
          state.due = input.value;
          changed();
        });
        return input;
      }
      case 'who':
        return textInput(state, 'who', 'who', changed);
      case 'rate':
        return textInput(state, 'rate', 'rate', changed, { inputmode: 'decimal' });
      case 'term':
        return textInput(state, 'term', 'term', changed, { inputmode: 'numeric' });
      case 'day':
        return textInput(state, 'day', 'day', changed, { inputmode: 'numeric' });
      case 'tags':
        return textInput(state, 'tags', 'tags', changed);
    }
  };

  const renderFields = (): void => {
    fieldsBox.replaceChildren();
    for (const name of KIND_FIELDS[state.kind]) {
      fieldsBox.append(row(LABELS[name], control(name)));
      if (name === 'due') {
        refreshWhen();
        fieldsBox.append(whenLine);
      }
    }
  };

  const kindSelect = h('select', { 'data-field': 'kind' });
  for (const k of KINDS) kindSelect.append(h('option', { value: k }, KIND_LABEL[k]));
  kindSelect.value = state.kind;
  kindSelect.addEventListener('change', () => {
    state.kind = kindSelect.value as Kind;
    refreshSentence();
    renderFields();
  });

  const save = h('button', { type: 'button', class: 'btn primary', 'data-action': 'save' }, 'Сохранить');
  save.addEventListener('click', () => opts.onSave(recordFromState(state, opts.now())));
  const cancel = h('button', { type: 'button', class: 'btn', 'data-action': 'cancel' }, 'Отмена');
  cancel.addEventListener('click', () => opts.onCancel());

  const actions = h('div', { class: 'actions' }, save, cancel);
  if (opts.editing && opts.onDelete) actions.append(deleteControl(opts.onDelete));

  refreshSentence();
  renderFields();
  return h(
    'section',
    { class: 'card', 'data-testid': 'card' },
    opts.notice ? h('p', { class: 'notice', role: 'status' }, opts.notice) : null,
    sentence,
    h('p', { class: 'raw' }, `Ты сказал: «${state.rawText}»`),
    row('Тип', kindSelect),
    fieldsBox,
    actions,
  );
}

/** «Удалить» → in-page confirm (no native dialogs, they behave differently across browsers). */
function deleteControl(onDelete: () => void): HTMLElement {
  const box = h('span', { class: 'confirm-box' });
  const ask = h('button', { type: 'button', class: 'btn danger', 'data-action': 'delete' }, 'Удалить');
  const show = (): void => {
    const yes = h('button', { type: 'button', class: 'btn danger', 'data-action': 'delete-yes' }, 'Да, удалить');
    const no = h('button', { type: 'button', class: 'btn', 'data-action': 'delete-no' }, 'Нет');
    yes.addEventListener('click', onDelete);
    no.addEventListener('click', () => box.replaceChildren(ask));
    box.replaceChildren(h('span', { class: 'confirm-text' }, 'Точно удалить?'), yes, no);
  };
  ask.addEventListener('click', show);
  box.append(ask);
  return box;
}
