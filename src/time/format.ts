// ALL times shown in the UI go through formatMsk (invariant 5): big MSK time, small device time if the zone differs.
// Calendar math uses UTC getters on (instant + offset) only, never the device zone, except the small local line.
import { MSK_OFFSET_MIN } from '../config';

export interface MskTime {
  /** «23.10 19:00 МСК» (the year is added when it is not the current MSK year). */
  big: string;
  /** «у тебя 12:00» (with the date when the day differs), or null when the device is on MSK. */
  small: string | null;
}

export interface FormatOptions {
  /** Device offset from UTC in minutes at that instant; default: the real device zone. */
  deviceOffsetMin?: number;
  /** Reference "now" for the year check; default: the current time. */
  now?: Date;
}

const pad = (n: number): string => String(n).padStart(2, '0');

interface Parts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

function partsAt(ms: number, offsetMin: number): Parts {
  const t = new Date(ms + offsetMin * 60_000);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() };
}

const clock = (p: Parts): string => `${pad(p.h)}:${pad(p.mi)}`;
const dayMonth = (p: Parts): string => `${pad(p.d)}.${pad(p.mo)}`;

export function formatMsk(utcIso: string, opts: FormatOptions = {}): MskTime {
  const ms = Date.parse(utcIso);
  if (Number.isNaN(ms)) return { big: '—', small: null };
  const msk = partsAt(ms, MSK_OFFSET_MIN);
  const nowYear = partsAt((opts.now ?? new Date()).getTime(), MSK_OFFSET_MIN).y;
  const date = msk.y === nowYear ? dayMonth(msk) : `${dayMonth(msk)}.${msk.y}`;
  const big = `${date} ${clock(msk)} МСК`;
  const deviceOffset = opts.deviceOffsetMin ?? -new Date(ms).getTimezoneOffset();
  if (deviceOffset === MSK_OFFSET_MIN) return { big, small: null };
  const local = partsAt(ms, deviceOffset);
  const sameDay = local.y === msk.y && local.mo === msk.mo && local.d === msk.d;
  return { big, small: `у тебя ${sameDay ? '' : `${dayMonth(local)} `}${clock(local)}` };
}

/** «сегодня» / «завтра» / «23.10» for a short human sentence (MSK calendar days). */
export function mskDayLabel(utcIso: string, now: Date): string {
  const ms = Date.parse(utcIso);
  const msk = partsAt(ms, MSK_OFFSET_MIN);
  const today = partsAt(now.getTime(), MSK_OFFSET_MIN);
  const dayNo = (p: Parts): number => Math.floor(Date.UTC(p.y, p.mo - 1, p.d) / 86_400_000);
  const diff = dayNo(msk) - dayNo(today);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  return msk.y === today.y ? dayMonth(msk) : `${dayMonth(msk)}.${msk.y}`;
}

/** «19:00» in MSK. */
export function mskClock(utcIso: string): string {
  return clock(partsAt(Date.parse(utcIso), MSK_OFFSET_MIN));
}

/** Value for <input type="datetime-local"> showing the instant in MSK: «2026-10-23T19:00». */
export function toMskInput(utcIso: string | null): string {
  if (!utcIso || Number.isNaN(Date.parse(utcIso))) return '';
  const p = partsAt(Date.parse(utcIso), MSK_OFFSET_MIN);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${clock(p)}`;
}

/** «2026-10-23T19:00» typed as MSK -> ISO UTC; undefined when empty or invalid. */
export function fromMskInput(value: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return undefined;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi) - MSK_OFFSET_MIN * 60_000;
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}
