// Shared app context + the sheet (modal) used for editing a record or a wallet.
import { LAST_WALLET_KEY, LEARNED_KEY } from '../config';
import type { PocketDb } from '../db/db';
import type { RecordRow, WalletRow } from '../db/types';
import { learnFromEdit, sanitizeLearned } from '../parser/learned';
import { renderCard } from './card';
import { stateFromRecord } from './card-model';
import { h } from './dom';

export interface App {
  db: PocketDb;
  wallets: WalletRow[];
  /** Live (not deleted) records. */
  records: RecordRow[];
  now: () => Date;
  refresh: () => Promise<void>;
  showTab: (name: string) => void;
}

export interface Sheet {
  close: () => void;
}

export function openSheet(content: HTMLElement): Sheet {
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'sheet-body' }, content));
  document.body.append(sheet);
  document.body.classList.add('sheet-open');
  return {
    close: () => {
      sheet.remove();
      if (!document.querySelector('.sheet')) document.body.classList.remove('sheet-open');
    },
  };
}

/** Close every open sheet (a new card must never be hidden behind an edit sheet). */
export function closeAllSheets(): void {
  document.querySelectorAll('.sheet').forEach((el) => el.remove());
  document.body.classList.remove('sheet-open');
}

/**
 * The owner saved the edit sheet. A changed kind or wallet is remembered for similar phrases (corrections memory);
 * a changed wallet becomes the «last wallet». Settings go first: the record write triggers the backup.
 * The sheet is the owner's decision, so the «unsure» flag (`refine`) is dropped with the rebuilt record.
 */
async function saveEdited(app: App, before: RecordRow, after: RecordRow): Promise<void> {
  const walletChanged = before.wallet_id !== after.wallet_id;
  if (before.kind !== after.kind || walletChanged) {
    const learned = sanitizeLearned(await app.db.getSetting<unknown>(LEARNED_KEY));
    await app.db.setSetting(LEARNED_KEY, learnFromEdit({ before, after, learned, wallets: app.wallets, now: app.now() }));
  }
  if (walletChanged && after.wallet_id) await app.db.setSetting(LAST_WALLET_KEY, after.wallet_id);
  await app.db.putRecord(after);
}

/**
 * Tap on a list row (or «Изменить» in the toast): edit the record in a sheet. Save = upsert by id; delete = soft delete.
 * `onChange` gets the saved record, or null after a delete.
 */
export function editRecord(app: App, rec: RecordRow, onChange?: (rec: RecordRow | null) => void): void {
  let sheet: Sheet | undefined;
  const done = async (result: RecordRow | null): Promise<void> => {
    sheet?.close();
    await app.refresh();
    onChange?.(result);
  };
  const card = renderCard({
    state: stateFromRecord(rec),
    wallets: app.wallets,
    now: app.now,
    editing: true,
    remindFor: rec,
    onSave: (updated) => {
      void saveEdited(app, rec, updated).then(() => done(updated));
    },
    onCancel: () => sheet?.close(),
    onDelete: () => {
      void app.db.softDelete(rec.id, app.now().toISOString()).then(() => done(null));
    },
  });
  sheet = openSheet(card);
}
