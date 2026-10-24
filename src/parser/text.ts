// Shared helpers for rules: Cyrillic-safe word regexes and title extraction.
// (JS `\b` and `\w` are ASCII-only, so word boundaries are explicit lookarounds.)
import type { Span } from './types';

/** Regex for `pattern` as whole word(s) at a word start; `pattern` may end with \p{L}* for endings. */
export function word(pattern: string, flags = 'u'): RegExp {
  return new RegExp(`(?<![\\p{L}\\d])(?:${pattern})(?![\\p{L}\\d])`, flags);
}

export function findSpan(lower: string, re: RegExp): Span | null {
  const m = re.exec(lower);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

/** Sorted, non-overlapping union of spans. */
function mergeSpans(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

const STOP_WORDS =new Set(['на', 'за', 'с', 'со', 'в', 'во', 'по', 'и', 'а', 'мне', 'что']);

/** Remove spans from the case-preserved text and tidy the rest into a short title. */
export function cutTitle(norm: string, spans: Span[], extraStop: string[] = []): string {
  let text = norm;
  for (const s of mergeSpans(spans).reverse()) {
    text = text.slice(0, s.start) + ' ' + text.slice(s.end);
  }
  const stop = new Set([...STOP_WORDS, ...extraStop]);
  const words = text
    .replace(/[,;:!?.]+(?=\s|$)/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
  const isStop = (w: string): boolean => stop.has(w.toLowerCase().replace(/ё/g, 'е'));
  while (words.length > 0 && isStop(words[0])) words.shift();
  while (words.length > 0 && isStop(words[words.length - 1])) words.pop();
  return words.join(' ');
}
