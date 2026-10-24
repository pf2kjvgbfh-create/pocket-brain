// «Дела» (reminders + subscriptions by date) and «Мысли» (ideas with a tag filter).
import { subscriptionNextDue } from '../money/totals';
import type { RecordRow } from '../db/types';
import type { App } from './app';
import { h } from './dom';
import { listOf } from './rows';

function dueOf(app: App, r: RecordRow): string | null {
  return r.kind === 'subscription' ? subscriptionNextDue(r.fields, r.due_utc, app.now()) : r.due_utc;
}

export function renderTodo(app: App, root: HTMLElement): void {
  const items = app.records
    .filter((r) => r.kind === 'reminder' || r.kind === 'subscription')
    .map((r) => ({ r, due: dueOf(app, r) }))
    .sort((a, b) => {
      if (a.due === b.due) return 0;
      if (a.due === null) return 1;
      if (b.due === null) return -1;
      return a.due < b.due ? -1 : 1;
    })
    .map((x) => x.r);
  root.replaceChildren(h('h1', {}, 'Дела'), listOf(app, items, { showTime: 'due' }, 'Пока нет дел. Скажи «напомни завтра в 19:00 …».'));
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
