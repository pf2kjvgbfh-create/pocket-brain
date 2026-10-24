// The app's storage: records, wallets, settings, drafts. Every write is an upsert by id, so nothing duplicates.
import { MIGRATIONS, openDatabase, req, type Migration, type StoreName } from './idb';
import type { DraftRow, RecordRow, WalletRow } from './types';

interface SettingRow {
  key: string;
  value: unknown;
}

export class PocketDb {
  private constructor(private readonly db: IDBDatabase) {}

  /** `factory` and `migrations` are injectable for tests. */
  static async open(
    name = 'pocket-brain',
    factory: IDBFactory = indexedDB,
    migrations: Migration[] = MIGRATIONS,
  ): Promise<PocketDb> {
    return new PocketDb(await openDatabase(name, factory, migrations));
  }

  close(): void {
    this.db.close();
  }

  get version(): number {
    return this.db.version;
  }

  get storeNames(): string[] {
    return Array.from(this.db.objectStoreNames);
  }

  /** Run `fn` in one transaction; resolves when the transaction has committed. */
  private run<T>(stores: StoreName[], mode: IDBTransactionMode, fn: (s: (n: StoreName) => IDBObjectStore) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const tx = this.db.transaction(stores, mode);
      let result: T;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      fn((n) => tx.objectStore(n)).then((r) => {
        result = r;
      }, reject);
    });
  }

  // ---- records ----

  /** Insert or replace by id. */
  putRecord(r: RecordRow): Promise<void> {
    return this.run(['records'], 'readwrite', async (s) => {
      await req(s('records').put(r));
    });
  }

  /** Save a record and drop its draft in ONE transaction: either both happen or neither. */
  saveFromDraft(r: RecordRow, draftId: string): Promise<void> {
    return this.run(['records', 'drafts'], 'readwrite', async (s) => {
      const puts = req(s('records').put(r));
      const del = req(s('drafts').delete(draftId));
      await Promise.all([puts, del]);
    });
  }

  getRecord(id: string): Promise<RecordRow | undefined> {
    return this.run(['records'], 'readonly', (s) => req<RecordRow | undefined>(s('records').get(id)));
  }

  /** Every row including soft-deleted ones (for backup later). */
  listAllRecords(): Promise<RecordRow[]> {
    return this.run(['records'], 'readonly', (s) => req<RecordRow[]>(s('records').getAll()));
  }

  /** Rows that are not deleted. */
  async listRecords(): Promise<RecordRow[]> {
    return (await this.listAllRecords()).filter((r) => !r.deleted);
  }

  /** Soft delete: the row stays, marked deleted. Returns false if there is no such record. */
  softDelete(id: string, nowIso: string): Promise<boolean> {
    return this.run(['records'], 'readwrite', async (s) => {
      const row = await req<RecordRow | undefined>(s('records').get(id));
      if (!row) return false;
      await req(s('records').put({ ...row, deleted: true, updated_utc: nowIso }));
      return true;
    });
  }

  /** A live record with exactly this raw text created at or after `sinceIso` (newest first), if any. */
  async findRecentByRawText(text: string, sinceIso: string): Promise<RecordRow | undefined> {
    const rows = await this.listRecords();
    return rows
      .filter((r) => r.raw_text === text && r.created_utc >= sinceIso)
      .sort((a, b) => (a.created_utc < b.created_utc ? 1 : -1))[0];
  }

  // ---- wallets ----

  async listWallets(): Promise<WalletRow[]> {
    const rows = await this.run(['wallets'], 'readonly', (s) => req<WalletRow[]>(s('wallets').getAll()));
    return rows;
  }

  putWallet(w: WalletRow): Promise<void> {
    return this.run(['wallets'], 'readwrite', async (s) => {
      await req(s('wallets').put(w));
    });
  }

  // ---- settings ----

  async getSetting<T>(key: string): Promise<T | undefined> {
    const row = await this.run(['settings'], 'readonly', (s) => req<SettingRow | undefined>(s('settings').get(key)));
    return row?.value as T | undefined;
  }

  setSetting(key: string, value: unknown): Promise<void> {
    return this.run(['settings'], 'readwrite', async (s) => {
      await req(s('settings').put({ key, value } satisfies SettingRow));
    });
  }

  // ---- drafts ----

  putDraft(d: DraftRow): Promise<void> {
    return this.run(['drafts'], 'readwrite', async (s) => {
      await req(s('drafts').put(d));
    });
  }

  getDraft(id: string): Promise<DraftRow | undefined> {
    return this.run(['drafts'], 'readonly', (s) => req<DraftRow | undefined>(s('drafts').get(id)));
  }

  deleteDraft(id: string): Promise<void> {
    return this.run(['drafts'], 'readwrite', async (s) => {
      await req(s('drafts').delete(id));
    });
  }

  /** Pending drafts, newest first. */
  async listDrafts(): Promise<DraftRow[]> {
    const rows = await this.run(['drafts'], 'readonly', (s) => req<DraftRow[]>(s('drafts').getAll()));
    return rows.sort((a, b) => (a.created_utc < b.created_utc ? 1 : -1));
  }

  async findDraftByText(text: string): Promise<DraftRow | undefined> {
    return (await this.listDrafts()).find((d) => d.text === text);
  }
}
