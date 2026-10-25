// «Экспорт в Файлы»: the same allowlisted JSON as the backup, never split, handed to the phone's share sheet
// (or downloaded as a file when sharing files is not supported).
import type { PocketDb } from '../db/db';
import { buildBackup } from './serialize';
import { collectSource } from './source';

export interface ExportFile {
  filename: string;
  text: string;
}

export async function buildExport(db: PocketDb, now: Date = new Date()): Promise<ExportFile> {
  const text = JSON.stringify(buildBackup(await collectSource(db), now.toISOString()), null, 2);
  return { filename: `pocket-brain-export-${now.toISOString().slice(0, 10)}.json`, text };
}

export type DeliverResult = 'shared' | 'downloaded' | 'cancelled';

/** Share sheet when the browser can share this file, otherwise a Blob download. Must be called from a tap. */
export async function deliverExport(file: ExportFile): Promise<DeliverResult> {
  const blob = new File([file.text], file.filename, { type: 'application/json' });
  if (navigator.canShare?.({ files: [blob] })) {
    try {
      await navigator.share({ files: [blob], title: file.filename });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Any other failure (for example the tap was too long ago): fall back to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
