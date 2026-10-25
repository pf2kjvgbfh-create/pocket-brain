// The backup controller: one run = read the database, plan the files, upload what changed.
// A run is fire-and-forget after a save: its failure only changes the status line, it never blocks or undoes a save.
import { BACKUP } from '../config';
import type { PocketDb } from '../db/db';
import { BackupError, createGithubClient, messageFor } from './github';
import { createSingleFlight } from './queue';
import { buildBackup } from './serialize';
import { collectSource } from './source';
import { fileText, fingerprint, planFiles } from './split';
import { readToken } from './token';

export const LAST_OK_KEY = 'backup_last_ok_utc';
export const HASHES_KEY = 'backup_hashes';
/**
 * True once this device has made a successful backup or a restore. Until then a backup never overwrites a copy that
 * already exists in GitHub (a new phone with empty data must not wipe the old copy before the owner restores it).
 */
export const LINKED_KEY = 'backup_linked';
export const NEEDS_RESTORE = 'в GitHub уже есть копия — нажми «Восстановить из GitHub»';

export interface BackupStatus {
  running: boolean;
  /** ISO UTC of the last successful backup. */
  lastOkUtc: string | null;
  /** Why there is no fresh copy (friendly Russian), or null. */
  error: string | null;
}

export interface ControllerOptions {
  db: PocketDb;
  fetch: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  splitBytes?: number;
}

export interface BackupController {
  /** Ask for a backup (coalesced; never throws, never waits). */
  trigger: () => void;
  idle: () => Promise<void>;
  getStatus: () => BackupStatus;
  subscribe: (cb: (s: BackupStatus) => void) => () => void;
  /** Resolves when the saved "last copy" time has been loaded. */
  ready: Promise<void>;
}

export function createBackupController(opts: ControllerOptions): BackupController {
  const { db } = opts;
  const now = opts.now ?? ((): Date => new Date());
  let status: BackupStatus = { running: false, lastOkUtc: null, error: null };
  const listeners = new Set<(s: BackupStatus) => void>();

  const set = (patch: Partial<BackupStatus>): void => {
    status = { ...status, ...patch };
    for (const cb of listeners) cb(status);
  };

  async function run(): Promise<void> {
    const token = await readToken(db);
    if (!token) {
      set({ error: 'токен не введён' });
      return;
    }
    set({ running: true });
    try {
      const nowDate = now();
      const full = buildBackup(await collectSource(db), nowDate.toISOString());
      const client = createGithubClient({ token, fetch: opts.fetch, sleep: opts.sleep });
      if (!(await db.getSetting<boolean>(LINKED_KEY)) && (await client.getText(BACKUP.mainPath)) !== null) {
        set({ running: false, error: NEEDS_RESTORE });
        return;
      }
      const hashes = { ...((await db.getSetting<Record<string, string>>(HASHES_KEY)) ?? {}) };
      for (const planned of planFiles(full, opts.splitBytes ?? BACKUP.splitBytes)) {
        const fp = await fingerprint(planned.file);
        if (hashes[planned.path] === fp) continue;
        await client.putFile(planned.path, fileText(planned.file), `backup ${nowDate.toISOString()}`);
        hashes[planned.path] = fp;
        await db.setSetting(HASHES_KEY, hashes);
      }
      const ok = nowDate.toISOString();
      await db.setSetting(LAST_OK_KEY, ok);
      await db.setSetting(LINKED_KEY, true);
      set({ running: false, lastOkUtc: ok, error: null });
    } catch (err) {
      set({ running: false, error: err instanceof BackupError ? messageFor(err.kind) : 'не удалось сделать копию' });
    }
  }

  const flight = createSingleFlight(run);
  const ready = db.getSetting<string>(LAST_OK_KEY).then(
    (v) => {
      if (typeof v === 'string' && status.lastOkUtc === null) set({ lastOkUtc: v });
    },
    () => undefined,
  );

  return {
    trigger: () => flight.request(),
    idle: () => flight.idle(),
    getStatus: () => status,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    ready,
  };
}
