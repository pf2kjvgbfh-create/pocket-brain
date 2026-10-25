// The bottom toast («Записал: …» with «Отменить» / «Изменить»). One at a time: a new toast, a tap on one of its
// buttons or dismissToast() removes the old one WITHOUT calling its onExpire (that is how undo / a newer phrase
// cancel the automatic reminder).
import { h } from './dom';

export interface ToastAction {
  label: string;
  /** Value of `data-action` (tests and styling). */
  action: string;
  run: () => void;
}

export interface ToastOptions {
  text: string;
  actions?: ToastAction[];
  /** How long it stays. */
  ms: number;
  /** Runs only when the time passes untouched. */
  onExpire?: () => void;
}

let active: { el: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;

export const hasToast = (): boolean => active !== null;

export function dismissToast(): void {
  if (!active) return;
  clearTimeout(active.timer);
  active.el.remove();
  active = null;
}

export function showToast(opts: ToastOptions): void {
  dismissToast();
  const buttons = (opts.actions ?? []).map((a) => {
    const b = h('button', { type: 'button', 'data-action': a.action }, a.label);
    // Dismiss first and synchronously: the timer can never fire after a tap.
    b.addEventListener('click', () => {
      dismissToast();
      a.run();
    });
    return b;
  });
  const el = h('div', { class: 'toast', role: 'status', 'data-testid': 'toast' }, h('span', { class: 'toast-text' }, opts.text), ...buttons);
  const timer = setTimeout(() => {
    dismissToast();
    opts.onExpire?.();
  }, opts.ms);
  active = { el, timer };
  document.body.append(el);
}
