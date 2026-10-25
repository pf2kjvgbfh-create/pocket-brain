// Splitting a big backup by month, and putting it back together.
// A record's month is the UTC month of `created_utc` (stable: it never changes after the record is made).
import { BACKUP } from '../config';
import { FORMAT, VERSION, type BackupFile } from './serialize';
import type { RecordRow } from '../db/types';

export interface MonthFile {
  format: typeof FORMAT;
  version: typeof VERSION;
  /** `YYYY-MM` (UTC). */
  month: string;
  records: RecordRow[];
}

export interface PlannedFile {
  path: string;
  file: BackupFile | MonthFile;
}

const encoder = new TextEncoder();
export const byteLength = (s: string): number => encoder.encode(s).length;

export function monthOfUtc(iso: string): string {
  return iso.slice(0, 7);
}

export function monthPath(month: string): string {
  return BACKUP.monthPathPattern.replace('YYYY-MM', month);
}

/**
 * The files to upload. Small backup: one main file. Above `splitBytes` the main file keeps wallets/settings and a
 * `months` list, and the records go to one file per month. Month files come first, the main file last, so the
 * `months` list never points at a file that is not uploaded yet.
 */
export function planFiles(full: BackupFile, splitBytes: number = BACKUP.splitBytes): PlannedFile[] {
  if (byteLength(JSON.stringify(full)) <= splitBytes) return [{ path: BACKUP.mainPath, file: full }];
  const byMonth = new Map<string, RecordRow[]>();
  for (const r of full.records) {
    const m = monthOfUtc(r.created_utc);
    byMonth.set(m, [...(byMonth.get(m) ?? []), r]);
  }
  const months = [...byMonth.keys()].sort();
  const monthFiles: PlannedFile[] = months.map((month) => ({
    path: monthPath(month),
    file: { format: FORMAT, version: VERSION, month, records: byMonth.get(month) ?? [] },
  }));
  const main: BackupFile = { ...full, records: [], months };
  return [...monthFiles, { path: BACKUP.mainPath, file: main }];
}

export const fileText = (f: BackupFile | MonthFile): string => JSON.stringify(f);

/** SHA-256 of the file without `exported_utc`, so a re-run with unchanged data is recognised and skipped. Not secret. */
export async function fingerprint(f: BackupFile | MonthFile): Promise<string> {
  const stable = 'exported_utc' in f ? { ...f, exported_utc: '' } : f;
  const bytes = encoder.encode(JSON.stringify(stable));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Main file + its month files -> one backup with all the records. */
export function assembleBackup(main: BackupFile, months: Pick<MonthFile, 'records'>[]): BackupFile {
  const seen = new Set<string>();
  const records: RecordRow[] = [];
  for (const r of [...main.records, ...months.flatMap((m) => m.records)]) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      records.push(r);
    }
  }
  const { months: _months, ...rest } = main;
  void _months;
  return { ...rest, records };
}
