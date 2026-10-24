// Minimal DOM helpers. User text is only ever set through textContent / value, never innerHTML.
import { formatMsk } from '../time/format';

type Attrs = Record<string, string | boolean | number | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** Big MSK time with the small device time under it (only shown when the zone differs). Always via formatMsk. */
export function timeEl(utcIso: string | null | undefined, now: Date = new Date()): HTMLElement {
  if (!utcIso) return h('span', { class: 'time' }, h('span', { class: 't-big' }, 'без времени'));
  const t = formatMsk(utcIso, { now });
  return h('span', { class: 'time' }, h('span', { class: 't-big' }, t.big), t.small ? h('span', { class: 't-small' }, t.small) : null);
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}
