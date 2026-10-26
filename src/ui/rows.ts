// One tappable row per record, shared by «Дела», «Деньги» and «Мысли».
import { formatMoney } from '../money/format';
import { depositEnd, recordWhen, subscriptionNextDue } from '../money/totals';
import type { RecordRow } from '../db/types';
import { editRecord, type App } from './app';
import { DIRECTIONS } from './card-model';
import { h, timeEl } from './dom';
import { mskDate } from './saved-text';

const walletName = (app: App, id: string | null | undefined): string => app.wallets.find((w) => w.id === id)?.name ?? '';

export function rowTitle(r: RecordRow): string {
  return r.fields.title || r.raw_text;
}

/** Second line: what is useful besides the title (as parts; the first part of a debt / return is what happened). */
function subParts(app: App, r: RecordRow): string[] {
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
    case 'subscription': {
      // The next payment as a plain date: the hour of a monthly payment means nothing to the owner.
      const next = subscriptionNextDue(f, r.due_utc, app.now());
      parts.push(next ? `платёж ${mskDate(next, { now: app.now() })}` : f.day ? `${f.day}-го числа` : '');
      if (r.wallet_id) parts.push(walletName(app, r.wallet_id));
      break;
    }
    case 'idea':
      if (f.tags?.length) parts.push(f.tags.map((t) => `#${t}`).join(' '));
      break;
    default:
      if (r.wallet_id) parts.push(walletName(app, r.wallet_id));
  }
  if (f.currency) parts.push('в рублях не считается');
  return parts.filter(Boolean);
}

export interface RowOptions {
  showTime?: 'due' | 'created' | 'none';
  /** Inside a person's block in «Деньги»: the name is already the heading, so the row says what happened. */
  inPerson?: boolean;
}

export function recordRow(app: App, r: RecordRow, opts: RowOptions = {}): HTMLElement {
  const mode = opts.showTime ?? 'none';
  const byPerson = r.kind === 'held' || r.kind === 'debt' || r.kind === 'repay';
  const parts = subParts(app, r);
  let title = byPerson && r.fields.who ? r.fields.who : rowTitle(r);
  if (opts.inPerson && byPerson) title = r.kind === 'held' ? 'Храню его деньги' : (parts.shift() ?? title);
  const sub = parts.join(' · ');
  const side: HTMLElement[] = [];
  if (r.fields.amount_minor !== undefined) side.push(h('span', { class: 'amount' }, formatMoney(r.fields.amount_minor, r.fields.currency)));
  if (mode === 'due') {
    if (r.kind !== 'subscription') side.push(timeEl(r.due_utc, app.now())); // a subscription has «платёж DD.MM» below
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

export function listOf(app: App, rows: RecordRow[], opts: RowOptions, empty: string): HTMLElement {
  if (rows.length === 0) return h('p', { class: 'hint empty' }, empty);
  return h('ul', { class: 'rows' }, ...rows.map((r) => recordRow(app, r, opts)));
}
