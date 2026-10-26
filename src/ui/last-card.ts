// «Последняя запись» at the top of «Новое» (stage 7, B2). NOT a confirmation card: the record is already saved and
// nothing waits for a tap. It only offers «Изменить» / «Удалить» until the next phrase, and the reminder button.
import type { RecordRow } from '../db/types';
import type { App } from './app';
import { h } from './dom';
import { remindBlock } from './remind';
import { recordSentence } from './saved-text';

export interface LastCardOptions {
  app: App;
  /** The live records of the last phrase (one phrase may give several). */
  records: RecordRow[];
  /** Seconds left before «Напоминания» open by themselves, or null. */
  countdown: number | null;
  onEdit: (rec: RecordRow) => void;
  onDelete: () => void;
  /** A tap on «Поставить напоминание» (cancels the automatic open). */
  onRemindTap: () => void;
  /** «Не надо»: the automatic open is cancelled. */
  onStopAuto: () => void;
}

/** The countdown line; its text is updated in place every second (paintCountdown). */
function countdownLine(left: number | null, onStop: () => void): HTMLElement {
  const stop = h('button', { type: 'button', class: 'btn small', 'data-action': 'auto-stop' }, 'Не надо');
  stop.addEventListener('click', onStop);
  const line = h('p', { class: 'countdown', 'data-testid': 'countdown', role: 'status' }, h('span', { class: 'countdown-text' }), stop);
  paintCountdown(line, left);
  return line;
}

/**
 * While the countdown runs, the «Не открылось? …» hint waits (it only helps after a try) — so the card stays short and
 * the bottom toast never lies over the text box and «Записать».
 */
export function paintCountdown(line: Element | null, left: number | null): void {
  if (!(line instanceof HTMLElement)) return;
  line.hidden = left === null;
  const hint = line.closest('.remind')?.querySelector<HTMLElement>('.hint');
  if (hint) hint.hidden = left !== null;
  const text = line.querySelector('.countdown-text');
  if (text) text.textContent = left === null ? '' : `Ставлю напоминание через ${left}…`;
}

export function renderLastCard(o: LastCardOptions): HTMLElement {
  const { app, records } = o;
  const single = records.length === 1;
  const editBtn = (r: RecordRow): HTMLElement => {
    const b = h('button', { type: 'button', class: 'btn small', 'data-action': 'last-edit' }, 'Изменить');
    b.addEventListener('click', () => o.onEdit(r));
    return b;
  };
  const del = h('button', { type: 'button', class: 'btn small danger', 'data-action': 'last-delete' }, single ? 'Удалить' : `Удалить все (${records.length})`);
  del.addEventListener('click', o.onDelete);
  const say = (r: RecordRow): string => recordSentence(r, app.wallets, { now: app.now() });

  const body = single
    ? [h('p', { class: 'last-text' }, say(records[0])), h('div', { class: 'actions' }, editBtn(records[0]), del)]
    : [
        h('ul', { class: 'last-list' }, ...records.map((r) => h('li', { 'data-id': r.id }, h('span', { class: 'last-text' }, say(r)), editBtn(r)))),
        h('div', { class: 'actions' }, del),
      ];
  const remind = single ? remindBlock(records[0], app.now(), o.onRemindTap, countdownLine(o.countdown, o.onStopAuto)) : null;
  paintCountdown(remind?.querySelector('[data-testid="countdown"]') ?? null, o.countdown); // now inside the card: hides the hint too
  return h(
    'section',
    { class: 'last', 'data-testid': 'saved', 'aria-label': 'Последняя запись' },
    h('h2', { class: 'last-head' }, 'Последняя запись'),
    ...body,
    remind,
  );
}
