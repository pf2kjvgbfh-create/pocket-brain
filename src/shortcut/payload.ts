// Data for the iPhone Shortcut «Мозг-напомнить». The format is documented in docs/shortcut-payload.md:
// the Shortcut on the phone is built by hand and cannot be updated from code, so the keys must not change silently.
import { MSK_OFFSET_MIN, SHORTCUT_NAME } from '../config';
import type { RecordRow } from '../db/types';
import { subscriptionNextDue } from '../money/totals';
import { formatMsk } from '../time/format';

export interface ShortcutPayload {
  title: string;
  /** ISO 8601 with a fixed +03:00 offset: «2026-10-23T19:00:00+03:00». */
  due: string;
  /** The same instant in the DEVICE zone: «2026-10-23 21:00» (fallback if Shortcuts ignores the offset). */
  due_local: string;
  /** «23.10 19:00 МСК» (for humans). */
  due_msk: string;
  repeat: 'none' | 'monthly';
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** «YYYY-MM-DDTHH:mm:ss+03:00»: UTC getters on (instant + offset), never the device zone. */
function isoMsk(ms: number): string {
  const t = new Date(ms + MSK_OFFSET_MIN * 60_000);
  const date = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  const time = `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
  const sign = MSK_OFFSET_MIN < 0 ? '-' : '+';
  const abs = Math.abs(MSK_OFFSET_MIN);
  return `${date}T${time}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** «YYYY-MM-DD HH:mm» in the device zone. */
function localText(ms: number): string {
  const t = new Date(ms);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

/** Payload for a reminder / subscription with a date; null when there is nothing to remind about. */
export function buildPayload(r: RecordRow, now: Date): ShortcutPayload | null {
  if (r.kind !== 'reminder' && r.kind !== 'subscription') return null;
  const dueUtc = r.kind === 'subscription' ? subscriptionNextDue(r.fields, r.due_utc, now) : r.due_utc;
  if (!dueUtc) return null;
  const ms = Date.parse(dueUtc);
  if (Number.isNaN(ms)) return null;
  return {
    title: r.fields.title || r.raw_text,
    due: isoMsk(ms),
    due_local: localText(ms),
    due_msk: formatMsk(dueUtc, { now }).big,
    repeat: r.kind === 'subscription' ? 'monthly' : 'none',
  };
}

/** Built with encodeURIComponent only (URLSearchParams would write spaces as «+»). */
export function buildShortcutUrl(payload: ShortcutPayload): string {
  return (
    `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}` +
    `&input=text&text=${encodeURIComponent(JSON.stringify(payload))}`
  );
}
