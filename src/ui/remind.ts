// «Поставить напоминание»: a plain link to the iPhone Shortcut. A link (not a script that sets location.href)
// opens the app straight from the tap, which iOS needs, and needs no hooks for tests.
// The same link is also clicked by the page itself when the countdown after a reminder runs out (openShortcut).
import type { RecordRow } from '../db/types';
import { buildPayload, buildShortcutUrl } from '../shortcut/payload';
import { h } from './dom';
import { shortcutHelpHint } from './shortcut-help';

/**
 * The button and its hints for a SAVED record; null when there is no date to remind about. A subscription says
 * «о платеже» (it is never opened automatically: DECISIONS stage 7, item 12). `onTap` runs on the tap itself, before
 * the navigation (it cancels the automatic open, so the reminder is not set twice); the link is never blocked.
 */
export function remindBlock(rec: RecordRow, now: Date, onTap?: () => void, extra?: HTMLElement | null): HTMLElement | null {
  const payload = buildPayload(rec, now);
  if (!payload) return null;
  const label = rec.kind === 'subscription' ? 'Поставить напоминание о платеже' : 'Поставить напоминание';
  const link = h('a', { class: 'btn', href: buildShortcutUrl(payload), 'data-action': 'remind' }, label);
  if (onTap) link.addEventListener('click', onTap);
  return h(
    'div',
    { class: 'remind' },
    link,
    extra ?? null,
    shortcutHelpHint('Если iPhone спросит «Открыть?» — нажми «Открыть». '),
  );
}

/**
 * Automatic open after the undo window: a real anchor click (not location.href), so tests can intercept it with a
 * click listener exactly like the button. Whether Safari allows it without a tap is checked on the phone.
 */
export function openShortcut(url: string): void {
  const a = h('a', { href: url, 'data-action': 'remind-auto', hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
}
