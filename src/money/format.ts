// Money helpers: integer kopecks <-> text. Own formatter on purpose: Intl separators differ between engines.

const NBSP = ' ';

/** 123450 -> «1 234,50 ₽» (non-breaking spaces so the sign never wraps). */
export function formatRub(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.round(minor));
  const rub = Math.floor(abs / 100);
  const kop = String(abs % 100).padStart(2, '0');
  const grouped = String(rub).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${sign}${grouped},${kop}${NBSP}₽`;
}

/** «1 234,50» / «500» -> integer kopecks; anything that is not a plain non-negative amount -> undefined. */
export function parseRubles(input: string): number | undefined {
  const s = input.replace(/[\s  ]/g, '').replace(',', '.');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return undefined;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
}

/** Kopecks -> text for an input field: «500» or «1234,50» (no grouping). */
export function minorToInput(minor: number | undefined): string {
  if (minor === undefined) return '';
  const rub = Math.floor(minor / 100);
  const kop = minor % 100;
  return kop === 0 ? String(rub) : `${rub},${String(kop).padStart(2, '0')}`;
}
