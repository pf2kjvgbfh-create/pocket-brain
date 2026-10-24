// Tiny IndexedDB helpers (no library): promisified requests and versioned migrations.
import { DEFAULT_WALLETS } from '../config';
import type { WalletRow } from './types';

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
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error('IndexedDB open failed'));
    open.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
  });
}
