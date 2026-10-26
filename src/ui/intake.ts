// Incoming text (the `#t=` link or the typed box) -> a draft with an id, or an already saved record.
// Invariant 6: the hash is read ONCE and removed with history.replaceState; save is an upsert by id.
import { DUPLICATE_WINDOW_MIN } from '../config';
import type { PocketDb } from '../db/db';
import type { DraftRow, RecordRow } from '../db/types';

/** Text after `#t=`, percent-decoded; `+` stays a literal plus. null if the hash carries no `t=`. */
export function extractHashText(hash: string): string | null {
  if (!hash.startsWith('#t=')) return null;
  // Decode each run of %XX on its own: a literal «%» (as in «6,5%») must not stop the rest from decoding.
  const text = hash.slice(3).replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run; // not valid UTF-8: keep the characters as they are, never lose text
    }
  });
  return text.trim();
}

export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type IntakeResult = { type: 'draft'; draft: DraftRow } | { type: 'saved'; record: RecordRow };

/**
 * link: a pending draft with the same text is reused (a killed page left it; it is saved once).
 * repeat (DECISIONS item 11: the SAME opening of a link came back — reload, «back», a page restored from memory): a live
 * record with the same raw text saved in the last DUPLICATE_WINDOW_MIN minutes is shown as «Уже записано» instead.
 * A fresh link with the same phrase is a new dictation and makes a new record.
 */
export async function intakeText(db: PocketDb, text: string, now: Date, opts: { link: boolean; repeat: boolean }): Promise<IntakeResult> {
  if (opts.link) {
    const pending = await db.findDraftByText(text);
    if (pending) return { type: 'draft', draft: pending };
  }
  if (opts.repeat) {
    const since = new Date(now.getTime() - DUPLICATE_WINDOW_MIN * 60_000).toISOString();
    const recent = await db.findRecentByRawText(text, since);
    if (recent) return { type: 'saved', record: recent };
  }
  const draft: DraftRow = { id: newId(), text, created_utc: now.toISOString() };
  await db.putDraft(draft);
  return { type: 'draft', draft };
}

/**
 * Is this the same opening of a link coming back (not a new dictation)? Only the first read on load can be one —
 * a reload or «back / forward» (`navigation.type`) — or a page restored from memory (`pageshow.persisted`).
 * A `hashchange` (the Shortcut opened the link again in the open tab) is always new.
 */
export function isRepeatOpen(navigationType: string | undefined, persisted: boolean, onLoad: boolean): boolean {
  if (persisted) return true;
  return onLoad && (navigationType === 'reload' || navigationType === 'back_forward');
}

function navigationType(): string | undefined {
  const entry = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
  return entry?.type;
}

/**
 * Reads `#t=` on load, `hashchange` and `pageshow`. The hash is removed synchronously (before any await), so a
 * second event for the same link finds nothing: the handler runs once per link.
 */
export function installHashListeners(onText: (text: string, repeat: boolean) => void): void {
  const consume = (repeat: boolean): void => {
    const text = extractHashText(window.location.hash);
    if (text === null) return;
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    if (text !== '') onText(text, repeat);
  };
  window.addEventListener('hashchange', () => consume(false));
  window.addEventListener('pageshow', (e) => consume(isRepeatOpen(undefined, e.persisted, false)));
  consume(isRepeatOpen(navigationType(), false, true));
}
