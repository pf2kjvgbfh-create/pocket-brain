import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helper without type declarations
import { buildPrecacheList, extractAssetPaths, renderSw, versionHash } from '../scripts/sw-lib.mjs';

const base = '/pocket-brain/';
const html = `<script type="module" crossorigin src="/pocket-brain/assets/index-ab12.js"></script>
<link rel="stylesheet" href="/pocket-brain/assets/index-cd34.css">
<link rel="modulepreload" href="/pocket-brain/assets/chunk-ef56.js?x=1#y">
<a href="https://example.com/x">external</a><a href="/other/y.js">elsewhere</a>`;

describe('extractAssetPaths', () => {
  it('keeps only urls under base, strips query/hash, sorted and unique', () => {
    expect(extractAssetPaths(html + html, base)).toEqual([
      'assets/chunk-ef56.js',
      'assets/index-ab12.js',
      'assets/index-cd34.css',
    ]);
  });
});

describe('buildPrecacheList', () => {
  it('always includes the shell entry urls', () => {
    expect(buildPrecacheList(['assets/a.js'], base)).toEqual([
      '/pocket-brain/',
      '/pocket-brain/index.html',
      '/pocket-brain/assets/a.js',
    ]);
  });
});

describe('versionHash', () => {
  it('is stable regardless of order and changes with content', () => {
    const a = versionHash([['a', Buffer.from('1')], ['b', Buffer.from('2')]]);
    const b = versionHash([['b', Buffer.from('2')], ['a', Buffer.from('1')]]);
    const c = versionHash([['a', Buffer.from('1')], ['b', Buffer.from('3')]]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('renderSw', () => {
  it('fills version, base and precache list', () => {
    const out = renderSw("v='__VERSION__';b='__BASE__';p=__PRECACHE__;", {
      version: 'abc',
      base,
      precache: ['/pocket-brain/'],
    });
    expect(out).toContain("v='abc'");
    expect(out).toContain("b='/pocket-brain/'");
    expect(out).toContain('"/pocket-brain/"');
    expect(out).not.toContain('__');
  });
});
