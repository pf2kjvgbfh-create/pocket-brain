// Stage 7 parser spec: every phrase of the QA check (tests/fixtures/phrases-qa.ru.json), run through parseMany.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WALLETS } from '../src/config';
import { parseMany } from '../src/parser/index';
import type { ParseResult } from '../src/parser/types';

type Expected = Record<string, unknown> & { kind: string };
interface QaPhrase {
  text: string;
  now?: string;
  expected: Expected | Expected[];
}

const fixture: { now: string; phrases: QaPhrase[] } = JSON.parse(
  readFileSync(new URL('./fixtures/phrases-qa.ru.json', import.meta.url), 'utf8'),
);

/** Exactly the keys the fixture asserts; null in the fixture = the key is absent. */
function pick(r: ParseResult, expected: Expected): Record<string, unknown> {
  const fields = r.fields as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(expected)) {
    let v: unknown;
    if (k === 'kind') v = r.kind;
    else if (k === 'tags') v = r.tags;
    else if (k === 'walletless') v = r.walletless;
    else v = fields[k];
    out[k] = v === undefined ? null : v;
  }
  return out;
}

describe('fixture phrases-qa.ru.json', () => {
  for (const p of fixture.phrases) {
    it(p.text, () => {
      const results = parseMany(p.text, new Date(p.now ?? fixture.now), DEFAULT_WALLETS);
      const expected = Array.isArray(p.expected) ? p.expected : [p.expected];
      expect(results.map((r, i) => (expected[i] ? pick(r, expected[i]) : r))).toEqual(expected);
      for (const r of results) expect(r.raw_text).toBe(p.text);
    });
  }
});
