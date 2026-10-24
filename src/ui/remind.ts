// «Поставить напоминание»: a plain link to the iPhone Shortcut. A link (not a script that sets location.href)
// opens the app straight from the tap, which iOS needs, and needs no hooks for tests.
import type { RecordRow } from '../db/types';
import { buildPayload, buildShortcutUrl } from '../shortcut/payload';
import { h } from './dom';

/** The button and its hint for a SAVED record; null when there is no date to remind about. */
export function remindBlock(rec: RecordRow, now: Date): HTMLElement | null {
  const payload = buildPayload(rec, now);
  if (!payload) return null;
  return h(
    'div',
    { class: 'remind' },
    h('a', { class: 'btn', href: buildShortcutUrl(payload), 'data-action': 'remind' }, 'Поставить напоминание'),
    h('p', { class: 'hint small' }, 'Откроется Команда «Мозг-напомнить» — если iPhone спросит, нажми «Открыть»'),
  );
}
