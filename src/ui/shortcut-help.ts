// «Не открылось? Нужна Команда «Мозг-напомнить» — как сделать» (stage 7, B7): the steps from SETUP section 4 in
// plain words, in a small sheet. The ONE place for these steps in the app: stage 8 replaces them with one-tap install
// buttons on a page «Установка».
import { SHORTCUT_NAME } from '../config';
import { openSheet } from './app';
import { h } from './dom';

export const SHORTCUT_STEPS: readonly string[] = [
  `Открой приложение «Команды» → «+» вверху → назови команду «${SHORTCUT_NAME}» (точно так, с дефисом).`,
  'Нажми на строку «Принимать …» вверху и оставь только «Текст».',
  'Добавь действие «Получить словарь из входных данных». Вход — «Вход команды».',
  'Добавь «Получить значение словаря», ключ title. Потом ещё одно такое же — ключ due.',
  'Добавь «Получить даты из входных данных». Вход — значение due.',
  'Добавь «Добавить новое напоминание»: название — значение title, дата — даты из прошлого шага.',
  'Вернись сюда и нажми «Поставить напоминание» ещё раз. Если iPhone спросит «Открыть?» — нажми «Открыть».',
];

export function openShortcutHelp(): void {
  const close = h('button', { type: 'button', class: 'btn primary', 'data-action': 'help-close' }, 'Понятно');
  const sheet = openSheet(
    h(
      'section',
      { class: 'help', 'data-testid': 'shortcut-help' },
      h('h2', {}, `Как сделать Команду «${SHORTCUT_NAME}»`),
      h('p', { class: 'hint' }, 'Один раз, 3 минуты. Без неё приложение не может поставить напоминание само.'),
      h('ol', { class: 'steps' }, ...SHORTCUT_STEPS.map((s) => h('li', {}, s))),
      h('div', { class: 'actions' }, close),
    ),
  );
  close.addEventListener('click', () => sheet.close());
}

/**
 * The hint line under the reminder button (`lead` goes first, so the card needs one short line, not two). «как
 * сделать» is an inline link: it stays in the text line, its padding makes the finger target 44 px high.
 */
export function shortcutHelpHint(lead = ''): HTMLElement {
  const how = h('a', { href: '#', class: 'link', role: 'button', 'data-action': 'shortcut-help' }, 'как сделать');
  how.addEventListener('click', (e) => {
    e.preventDefault(); // never touches the address (the `#t=` intake listens to it)
    openShortcutHelp();
  });
  return h('p', { class: 'hint small' }, `${lead}Не открылось? Нужна Команда «${SHORTCUT_NAME}» — `, how);
}
