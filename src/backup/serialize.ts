// ALLOWLIST serializer (invariant 3): only the fields named here ever leave the device.
// A field added to a record later is NOT backed up until it is added to a list below on purpose.
import { BACKUP_SETTING_KEYS } from '../config';
import type { RecordFields, RecordRow, WalletRow } from '../db/types';
import { KINDS } from '../ui/card-model';
import { TOKEN_KEY } from './token';

export const FORMAT = 'pocket-brain';
export const VERSION = 1;

export interface BackupFile {
  format: typeof FORMAT;
  version: typeof VERSION;
  exported_utc: string;
  wallets: WalletRow[];
  settings: Record<string, unknown>;
  records: RecordRow[];
  /** Present only in a split backup: the months whose records live in `data/records-YYYY-MM.json`. */
  months?: string[];
}

export interface BackupSource {
  records: RecordRow[];
  wallets: WalletRow[];
  /** Any settings; only the allowlisted keys are written. */
  settings: Record<string, unknown>;
}

const FIELD_KEYS: (keyof RecordFields)[] = ['title', 'amount_minor', 'to_wallet_id', 'who', 'rate', 'term_months', 'day', 'tags'];

export function serializeRecord(r: RecordRow): RecordRow {
  const fields: RecordFields = {};
  const src = (r.fields ?? {}) as Record<string, unknown>;
  for (const k of FIELD_KEYS) {
    if (src[k] !== undefined) (fields as Record<string, unknown>)[k] = src[k];
  }
  return {
    id: r.id,
    kind: r.kind,
    raw_text: r.raw_text,
    fields,
    wallet_id: r.wallet_id,
    due_utc: r.due_utc,
    created_utc: r.created_utc,
    updated_utc: r.updated_utc,
    deleted: r.deleted,
  };
}

export function serializeWallet(w: WalletRow): WalletRow {
  return { id: w.id, name: w.name, hidden: w.hidden, start_balance_minor: w.start_balance_minor };
}

/** Only allowlisted keys; the token key is refused even if it is (wrongly) on the list. */
export function pickSettings(settings: Record<string, unknown>, allowed: readonly string[] = BACKUP_SETTING_KEYS): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k !== TOKEN_KEY && settings[k] !== undefined) out[k] = settings[k];
  }
  return out;
}

export function buildBackup(src: BackupSource, exportedUtc: string, allowed: readonly string[] = BACKUP_SETTING_KEYS): BackupFile {
  return {
    format: FORMAT,
    version: VERSION,
    exported_utc: exportedUtc,
    wallets: src.wallets.map(serializeWallet),
    settings: pickSettings(src.settings, allowed),
    records: src.records.map(serializeRecord),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Field values from outside: a value of the wrong type is dropped (it would break the lists or the totals). */
function sanitizeFields(v: unknown): RecordFields {
  if (!isObj(v)) return {};
  const out: RecordFields = {};
  if (isStr(v.title)) out.title = v.title;
  if (isStr(v.to_wallet_id)) out.to_wallet_id = v.to_wallet_id;
  if (isStr(v.who)) out.who = v.who;
  if (isNum(v.amount_minor)) out.amount_minor = Math.round(v.amount_minor);
  if (isNum(v.rate)) out.rate = v.rate;
  if (isNum(v.term_months)) out.term_months = Math.round(v.term_months);
  if (isNum(v.day)) out.day = Math.round(v.day);
  if (Array.isArray(v.tags)) out.tags = v.tags.filter(isStr);
  return out;
}

/** A record from outside is untrusted: keep it only if the shape is right, and copy through the allowlist. */
export function sanitizeRecord(v: unknown): RecordRow | null {
  if (!isObj(v)) return null;
  if (!isStr(v.id) || !isStr(v.raw_text) || !isStr(v.created_utc) || !isStr(v.updated_utc)) return null;
  if (!isStr(v.kind) || !(KINDS as string[]).includes(v.kind)) return null;
  return serializeRecord({
    id: v.id,
    kind: v.kind as RecordRow['kind'],
    raw_text: v.raw_text,
    fields: sanitizeFields(v.fields),
    wallet_id: isStr(v.wallet_id) ? v.wallet_id : null,
    due_utc: isStr(v.due_utc) ? v.due_utc : null,
    created_utc: v.created_utc,
    updated_utc: v.updated_utc,
    deleted: v.deleted === true,
  });
}

export function sanitizeWallet(v: unknown): WalletRow | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name)) return null;
  const bal = typeof v.start_balance_minor === 'number' && Number.isFinite(v.start_balance_minor) ? Math.round(v.start_balance_minor) : 0;
  return { id: v.id, name: v.name, hidden: v.hidden === true, start_balance_minor: bal };
}

export function sanitizeList<T>(list: unknown, one: (v: unknown) => T | null): T[] {
  return Array.isArray(list) ? list.map(one).filter((x): x is T => x !== null) : [];
}

/** Parse a main/export file. Throws a plain Russian message when it is not a Pocket Brain copy. */
export function parseBackup(text: string): BackupFile {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error('файл копии повреждён');
  }
  if (!isObj(v) || v.format !== FORMAT) throw new Error('это не копия Карманного мозга');
  if (typeof v.version !== 'number' || v.version > VERSION) throw new Error('копия сделана более новой версией приложения');
  return {
    format: FORMAT,
    version: VERSION,
    exported_utc: isStr(v.exported_utc) ? v.exported_utc : '',
    wallets: sanitizeList(v.wallets, sanitizeWallet),
    settings: pickSettings(isObj(v.settings) ? v.settings : {}),
    records: sanitizeList(v.records, sanitizeRecord),
    ...(Array.isArray(v.months) ? { months: v.months.filter(isStr) } : {}),
  };
}
