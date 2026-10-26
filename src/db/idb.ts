// Tiny IndexedDB helpers (no library): promisified requests and versioned migrations.
import { DEFAULT_WALLETS, LAST_WALLET_KEY, OLD_DEPOSIT_WALLET_ID } from '../config';
import type { RecordRow, WalletRow } from './types';

export type StoreName = 'records' | 'wallets' | 'settings' | 'drafts';

/** One migration upgrades the schema by one version: MIGRATIONS[0] creates version 1, and so on. */
export type Migration = (db: IDBDatabase, tx: IDBTransaction) => void;

export const MIGRATIONS: Migration[] = [
  // v1: the four stores; default wallets are seeded here (only when the database is created).
  (db, tx) => {
    db.createObjectStore('records', { keyPath: 'id' });
    db.createObjectStore('wallets', { keyPath: 'id' });
    db.createObjectStore('settings', { keyPath: 'key' });
    db.createObjectStore('drafts', { keyPath: 'id' });
    const wallets = tx.objectStore('wallets');
    for (const w of DEFAULT_WALLETS) {
      const row: WalletRow = { id: w.id, name: w.name, hidden: false, start_balance_minor: 0 };
      wallets.put(row);
    }
  },
  // v2 (stage 7): (1) deposits saved before v2 never moved money, but from v2 on a deposit takes its amount out of its
  // wallet — so every existing deposit loses its wallet, and no old balance changes. (2) Then the «Вклад» wallet goes
  // away — deleted when no record uses it any more and its start balance is 0, otherwise kept (it just no longer
  // matches speech, see walletRefs). A «last wallet» pointing to it is reset either way.
  (_db, tx) => {
    const id = OLD_DEPOSIT_WALLET_ID;
    const settings = tx.objectStore('settings');
    const last = settings.get(LAST_WALLET_KEY);
    last.onsuccess = () => {
      if ((last.result as { value?: unknown } | undefined)?.value === id) settings.delete(LAST_WALLET_KEY);
    };
    const records = tx.objectStore('records');
    const all = records.getAll();
    all.onsuccess = () => {
      const rows = (all.result as RecordRow[]).map((r) => {
        if (r.kind !== 'deposit' || r.wallet_id === null) return r;
        const row = { ...r, wallet_id: null };
        records.put(row);
        return row;
      });
      const wallet = tx.objectStore('wallets').get(id);
      wallet.onsuccess = () => {
        const row = wallet.result as WalletRow | undefined;
        if (!row || row.start_balance_minor !== 0) return;
        const used = rows.some((r) => r.wallet_id === id || r.fields?.to_wallet_id === id);
        if (!used) tx.objectStore('wallets').delete(id);
      };
    };
  },
];

export function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export function openDatabase(name: string, factory: IDBFactory, migrations: Migration[]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(name, migrations.length);
    open.onupgradeneeded = (event) => {
      const tx = open.transaction;
      if (!tx) return;
      for (let v = event.oldVersion; v < migrations.length; v += 1) migrations[v](open.result, tx);
    };
    open.onsuccess = () => {
      // A newer version of the app in another tab wants to upgrade: let go, or its upgrade would wait for this tab.
      open.result.onversionchange = () => open.result.close();
      resolve(open.result);
    };
    open.onerror = () => reject(open.error ?? new Error('IndexedDB open failed'));
    open.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
  });
}
