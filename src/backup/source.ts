// Reads everything that may go into a backup/export from the database (settings only through the allowlist).
import { BACKUP_SETTING_KEYS } from '../config';
import type { PocketDb } from '../db/db';
import type { BackupSource } from './serialize';

export async function collectSource(db: PocketDb): Promise<BackupSource> {
  const settings: Record<string, unknown> = {};
  for (const key of BACKUP_SETTING_KEYS) {
    const v = await db.getSetting<unknown>(key);
    if (v !== undefined) settings[key] = v;
  }
  return { records: await db.listAllRecords(), wallets: await db.listWallets(), settings };
}
