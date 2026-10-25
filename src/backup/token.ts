// The GitHub token: typed by the owner into Settings, kept ONLY in the IndexedDB `settings` store under TOKEN_KEY.
// Read only by: the backup runner (to send a backup), the restore button, and `hasToken` (a yes/no for the screen).
import type { PocketDb } from '../db/db';

export const TOKEN_KEY = 'github_token';

/** Header-safe: printable ASCII without spaces (a pasted newline or a Cyrillic letter would break the request). */
const TOKEN_SHAPE = /^[\x21-\x7e]+$/;

export type TokenCheck = { ok: true; token: string } | { ok: false; reason: string };

export function checkToken(raw: string): TokenCheck {
  const token = raw.trim();
  if (!token) return { ok: false, reason: 'Вставь токен в поле' };
  if (!TOKEN_SHAPE.test(token)) return { ok: false, reason: 'В токене лишние символы. Скопируй его на GitHub заново целиком' };
  return { ok: true, token };
}

export async function readToken(db: PocketDb): Promise<string | undefined> {
  const t = await db.getSetting<string>(TOKEN_KEY);
  return typeof t === 'string' && t !== '' ? t : undefined;
}

export async function hasToken(db: PocketDb): Promise<boolean> {
  return (await readToken(db)) !== undefined;
}

export function saveToken(db: PocketDb, token: string): Promise<void> {
  return db.setSetting(TOKEN_KEY, token);
}

export function clearToken(db: PocketDb): Promise<void> {
  return db.setSetting(TOKEN_KEY, '');
}
