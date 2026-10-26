// Restore from GitHub: read the main file (+ month files), merge by id, newest `updated_utc` wins.
import { BACKUP, LAST_WALLET_KEY, LEARNED_KEY } from '../config';
import type { PocketDb } from '../db/db';
import type { RecordRow, WalletRow } from '../db/types';
import { mergeLearned, sanitizeLearned } from '../parser/learned';
import type { GithubClient } from './github';
import { LINKED_KEY } from './runner';
import { parseBackup, pickSettings, sanitizeList, upgradeBackup, type BackupFile } from './serialize';
import { assembleBackup, monthPath } from './split';
import { sanitizeRecord } from './serialize';

export interface Merged {
  /** Records to write: new ones and ones where the backup is newer. */
  records: RecordRow[];
  wallets: WalletRow[];
  /** Allowlisted settings of the copy that passed validation (last wallet, corrections memory). */
  settings: Record<string, unknown>;
  /** Live (not deleted) records in the backup: the number shown to the owner. */
  liveCount: number;
}

const time = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Records: by id; the backup wins only when its `updated_utc` is strictly newer (a tie keeps the local one).
 * Wallets: by id; a missing wallet is added; for an existing one the backup version wins (wallets carry no
 * timestamp, and restoring a backup means "bring back what was saved").
 */
export function mergeBackup(
  local: { records: RecordRow[]; wallets: WalletRow[] },
  remote: Pick<BackupFile, 'records' | 'wallets' | 'settings'>,
): Merged {
  const localById = new Map(local.records.map((r) => [r.id, r]));
  const records = remote.records.filter((r) => {
    const mine = localById.get(r.id);
    return !mine || time(r.updated_utc) > time(mine.updated_utc);
  });
  return {
    records,
    wallets: remote.wallets,
    settings: pickSettings(remote.settings),
    liveCount: remote.records.filter((r) => !r.deleted).length,
  };
}

/** Validated settings from the copy. The corrections memory is merged by entry (newest wins), the last wallet is replaced. */
async function applySettings(db: PocketDb, settings: Record<string, unknown>): Promise<void> {
  const last = settings[LAST_WALLET_KEY];
  if (typeof last === 'string') await db.setSetting(LAST_WALLET_KEY, last);
  if (settings[LEARNED_KEY] !== undefined) {
    const local = sanitizeLearned(await db.getSetting<unknown>(LEARNED_KEY));
    await db.setSetting(LEARNED_KEY, mergeLearned(local, sanitizeLearned(settings[LEARNED_KEY])));
  }
}

/** Write the merge in one transaction. The device counts as linked to the copy BEFORE the write, because the write triggers a backup. */
export async function applyMerge(db: PocketDb, merged: Merged): Promise<void> {
  const was = await db.getSetting<boolean>(LINKED_KEY);
  await db.setSetting(LINKED_KEY, true);
  try {
    // Settings first: the records write triggers a backup, which must already carry them.
    await applySettings(db, merged.settings);
    await db.putMany(merged.records, merged.wallets);
  } catch (err) {
    await db.setSetting(LINKED_KEY, was === true);
    throw err;
  }
}

/** Read the whole copy from GitHub. Throws BackupError (network/auth) or Error with a Russian message. */
export async function loadRemote(client: GithubClient): Promise<BackupFile> {
  const mainText = await client.getText(BACKUP.mainPath);
  if (mainText === null) throw new Error('в GitHub пока нет копии');
  const main = parseBackup(mainText);
  const months: { records: RecordRow[] }[] = [];
  for (const month of main.months ?? []) {
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const text = await client.getText(monthPath(month));
    if (text === null) throw new Error(`в копии не хватает файла за ${month}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`файл копии за ${month} повреждён`);
    }
    const list = (parsed as { records?: unknown }).records;
    months.push({ records: sanitizeList(list, sanitizeRecord) });
  }
  return upgradeBackup(assembleBackup(main, months));
}
