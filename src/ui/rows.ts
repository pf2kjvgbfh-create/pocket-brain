// One tappable row per record, shared by «Дела», «Деньги» and «Мысли».
import { formatMoney } from '../money/format';
import { depositEnd, recordWhen, subscriptionNextDue } from '../money/totals';
import type { RecordRow } from '../db/types';
import { editRecord, type App } from './app';
import { DIRECTIONS } from './card-model';
import { h, timeEl } from './dom';

const walletName = (app: App, id: string | null | undefined): string => app.wallets.find((w) => w.id === id)?.name ?? '';

export function rowTitle(r: RecordRow): string {
  return r.fields.title || r.raw_text;
}

/** Second line: what is useful besides the title. */
function subLine(app: App, r: RecordRow): string {
  const f = r.fields;
  const parts: string[] = [];
  switch (r.kind) {
    case 'held':
      if (f.rate !== undefined) parts.push(`${String(f.rate).replace('.', ',')}%`);
      if (f.term_months !== undefined) parts.push(`${f.term_months} мес.`);
      break;
    case 'deposit': {
      if (f.rate !== undefined) parts.push(`${String(f.rate).replace('.', ',')}%`);
      const end = depositEnd(r);
      if (end) parts.push(`до ${end}`);
      if (r.wallet_id) parts.push(`с «${walletName(app, r.wallet_id)}»`);
      break;
    }
    case 'debt':
    case 'repay':
      parts.push(DIRECTIONS[r.kind]?.find((d) => d.value === f.direction)?.label ?? '');
      if (r.wallet_id) parts.push(walletName(app, r.wallet_id));
      break;
    case 'transfer':
      parts.push(`${walletName(app, r.wallet_id) || '?'} → ${walletName(app, f.to_wallet_id) || '?'}`);
      break;
    case 'subscription':
      if (f.day) parts.push(`${f.day}-го числа`);
      if (r.wallet_id) parts.push(walletName(app, r.wallet_id));
      break;
    case 'idea':
      if (f.tags?.length) parts.push(f.tags.map((t) => `#${t}`).join(' '));
      break;
    default:
      if (r.wallet_id) parts.push(walletName(app, r.wallet_id));
  }
  if (f.currency) parts.push('в рублях не считается');
  return parts.filter(Boolean).join(' · ');
}

export function recordRow(app: App, r: RecordRow, opts: { showTime?: 'due' | 'created' | 'none' } = {}): HTMLElement {
  const mode = opts.showTime ?? 'none';
  const byPerson = r.kind === 'held' || r.kind === 'debt' || r.kind === 'repay';
  const title = byPerson && r.fields.who ? r.fields.who : rowTitle(r);
  const sub = subLine(app, r);
  const side: HTMLElement[] = [];
  if (r.fields.amount_minor !== undefined) side.push(h('span', { class: 'amount' }, formatMoney(r.fields.amount_minor, r.fields.currency)));
  if (mode === 'due') {
    const due = r.kind === 'subscription' ? subscriptionNextDue(r.fields, r.due_utc, app.now()) : r.due_utc;
    side.push(timeEl(due, app.now()));
  } else if (mode === 'created') side.push(timeEl(recordWhen(r), app.now())); // «вчера потратил»: the day it happened
  const btn = h(
    'button',
    { type: 'button', class: 'row', 'data-id': r.id, 'data-kind': r.kind },
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, title), sub ? h('span', { class: 'row-sub' }, sub) : null),
    side.length ? h('span', { class: 'row-side' }, ...side) : null,
  );
  btn.addEventListener('click', () => editRecord(app, r));
  return h('li', {}, btn);
}

export function listOf(app: App, rows: RecordRow[], opts: Parameters<typeof recordRow>[2], empty: string): HTMLElement {
  if (rows.length === 0) return h('p', { class: 'hint empty' }, empty);
  return h('ul', { class: 'rows' }, ...rows.map((r) => recordRow(app, r, opts)));
}
