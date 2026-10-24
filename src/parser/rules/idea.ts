// Ideas: explicit «идея:/мысль:/заметка:» prefix, tags from «#тег» or «тег(и): а, б», and the fallback
// for everything the other rules are not sure about (the text is never lost).
import { cutTitle, findSpan, word } from '../text';
import type { ParseContext, Rule, RuleMatch, Span } from '../types';

const PREFIX_RE = /^\s*(?:идея|мысль|заметка)(?![\p{L}\d])\s*:?/u;
const HASHTAG_RE = /#([\p{L}\d_]+)/gu;
const TAG_LIST_RE = new RegExp(`${word('теги?').source}\\s*:\\s*([^#\\n]+)`, 'u');
const TAG_SPLIT_RE = /,|(?<![\p{L}])и(?![\p{L}])/u;

export interface FoundTags {
  tags: string[];
  spans: Span[];
}

/** Tags from «#тег» and «тег: …» / «теги: а, б и в» (lower-case, no duplicates). */
export function findTags(lower: string): FoundTags {
  const tags: string[] = [];
  const spans: Span[] = [];
  for (const m of lower.matchAll(HASHTAG_RE)) {
    tags.push(m[1]);
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  const list = TAG_LIST_RE.exec(lower);
  if (list) {
    spans.push({ start: list.index, end: list.index + list[0].length });
    for (const part of list[1].split(TAG_SPLIT_RE)) {
      const tag = part.trim().replace(/[.!?;]+$/, '');
      if (tag) tags.push(tag);
    }
  }
  return { tags: [...new Set(tags)], spans };
}

function ideaTitle(ctx: ParseContext, extra: Span[]): string {
  return cutTitle(ctx.norm, [...extra, ...findTags(ctx.lower).spans]);
}

/** «идея: …» / «мысль: …» at the start → idea, highest priority. */
export const ideaPrefixRule: Rule = (ctx) => {
  const prefix = findSpan(ctx.lower, PREFIX_RE);
  if (!prefix) return null;
  return { kind: 'idea', confidence: 0.95, fields: { title: ideaTitle(ctx, [prefix]) } };
};

/** Nothing matched: keep it as an idea. Explicit tags make it a confident idea. */
export function ideaFallback(ctx: ParseContext): RuleMatch {
  const hasTags = findTags(ctx.lower).tags.length > 0;
  return { kind: 'idea', confidence: hasTags ? 0.6 : 0.3, fields: { title: ideaTitle(ctx, []) } };
}
