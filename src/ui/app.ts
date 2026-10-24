// Shared app context + the sheet (modal) used for editing a record or a wallet.
import type { PocketDb } from '../db/db';
import type { RecordRow, WalletRow } from '../db/types';
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

/** Tap on a list row: edit the record in a sheet. Save = upsert by id; delete = soft delete. */
export function editRecord(app: App, rec: RecordRow): void {
  let sheet: Sheet | undefined;
  const done = async (): Promise<void> => {
    sheet?.close();
    await app.refresh();
  };
  const card = renderCard({
    state: stateFromRecord(rec),
    wallets: app.wallets,
    now: app.now,
    editing: true,
    onSave: (updated) => {
      void app.db.putRecord(updated).then(done);
    },
    onCancel: () => sheet?.close(),
    onDelete: () => {
      void app.db.softDelete(rec.id, app.now().toISOString()).then(done);
    },
  });
  sheet = openSheet(card);
}
