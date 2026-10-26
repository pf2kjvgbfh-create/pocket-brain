// «Дела» (reminders + subscriptions: upcoming first, then past undone ones, then a collapsed «Сделано (N)»; stage 7
// B4) and «Мысли» (ideas with a tag filter).
import { subscriptionNextDue } from '../money/totals';
import type { RecordRow } from '../db/types';
import type { App } from './app';
import { h } from './dom';
import { listOf, recordRow } from './rows';

interface TodoItem {
  r: RecordRow;
  due: string | null;
}

function dueOf(app: App, r: RecordRow): string | null {
  return r.kind === 'subscription' ? subscriptionNextDue(r.fields, r.due_utc, app.now()) : r.due_utc;
}

/** Nearest first; no date at the end. */
function byDue(a: TodoItem, b: TodoItem): number {
  if (a.due === b.due) return 0;
  if (a.due === null) return 1;
  if (b.due === null) return -1;
  return a.due < b.due ? -1 : 1;
}

/** «сделано» marks a reminder done (or not done again); the row itself still opens the editor. */
async function setDone(app: App, r: RecordRow, done: boolean): Promise<void> {
  const nowIso = app.now().toISOString();
  const fields = { ...r.fields };
  if (done) fields.done_utc = nowIso;
  else delete fields.done_utc;
  await app.db.putRecord({ ...r, fields, updated_utc: nowIso });
  await app.refresh();
}

function todoRow(app: App, r: RecordRow): HTMLElement {
  const li = recordRow(app, r, { showTime: 'due' });
  if (r.kind !== 'reminder') {
    li.classList.add('todo-plain'); // a subscription repeats every month: nothing to tick off
    return li;
  }
  const box = h('input', { type: 'checkbox', 'data-action': 'done', 'aria-label': `Сделано: ${r.fields.title || r.raw_text}` });
  box.checked = !!r.fields.done_utc;
  box.addEventListener('change', () => void setDone(app, r, box.checked));
  li.classList.add('todo');
  li.prepend(h('label', { class: 'done-box', title: 'сделано' }, box));
  return li;
}

const todoList = (app: App, items: TodoItem[]): HTMLElement => h('ul', { class: 'rows' }, ...items.map((x) => todoRow(app, x.r)));

export function renderTodo(app: App, root: HTMLElement): void {
  const nowIso = app.now().toISOString();
  const doneWasOpen = root.querySelector<HTMLDetailsElement>('details[data-block="done"]')?.open === true;
  const items = app.records
    .filter((r) => r.kind === 'reminder' || r.kind === 'subscription')
    .map((r) => ({ r, due: dueOf(app, r) }))
    .sort(byDue);
  const done = items.filter((x) => x.r.kind === 'reminder' && x.r.fields.done_utc);
  const open = items.filter((x) => !done.includes(x));
  const past = open.filter((x) => x.r.kind === 'reminder' && x.due !== null && x.due < nowIso).reverse(); // the latest first
  const soon = open.filter((x) => !past.includes(x));

  const parts: HTMLElement[] = [h('h1', {}, 'Дела')];
  if (items.length === 0) parts.push(h('p', { class: 'hint empty' }, 'Пока нет дел. Скажи «напомни завтра в 19:00 …».'));
  if (soon.length > 0) parts.push(h('section', { class: 'block', 'data-block': 'soon' }, todoList(app, soon)));
  else if (items.length > 0) parts.push(h('p', { class: 'hint empty' }, 'Впереди дел нет.'));
  if (past.length > 0) parts.push(h('section', { class: 'block', 'data-block': 'past' }, h('h2', {}, 'Прошедшие'), todoList(app, past)));
  if (done.length > 0) {
    parts.push(
      h('details', { class: 'block done-block', 'data-block': 'done', open: doneWasOpen }, h('summary', {}, `Сделано (${done.length})`), todoList(app, done)),
    );
  }
  root.replaceChildren(...parts);
}

/** Tag currently used as a filter (kept across re-renders until the page is reloaded). */
let activeTag: string | null = null;

export function renderIdeas(app: App, root: HTMLElement): void {
  const ideas = app.records.filter((r) => r.kind === 'idea').sort((a, b) => (a.created_utc < b.created_utc ? 1 : -1));
  const allTags = [...new Set(ideas.flatMap((r) => r.fields.tags ?? []))].sort();
  if (activeTag && !allTags.includes(activeTag)) activeTag = null;
  const shown = activeTag ? ideas.filter((r) => r.fields.tags?.includes(activeTag as string)) : ideas;

  const chips = h('div', { class: 'chips' });
  const chip = (label: string, tag: string | null): HTMLElement => {
    const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(activeTag === tag), 'data-tag': tag ?? '' }, label);
    b.addEventListener('click', () => {
      activeTag = tag;
      renderIdeas(app, root);
    });
    return b;
  };
  if (allTags.length > 0) {
    chips.append(chip('Все', null), ...allTags.map((t) => chip(`#${t}`, t)));
  }
  root.replaceChildren(h('h1', {}, 'Мысли'), chips, listOf(app, shown, { showTime: 'created' }, 'Пока нет мыслей. Скажи «идея: …».'));
}
