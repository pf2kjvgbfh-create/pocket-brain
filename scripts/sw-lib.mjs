// Pure helpers for generating the service worker (unit-tested in tests/sw-lib.test.ts).
import { createHash } from 'node:crypto';

/**
 * Collect same-site URLs referenced by an HTML document (src / href attributes that start with `base`).
 * Returns paths relative to the site root, without `base`, without query/hash, de-duplicated.
 */
export function extractAssetPaths(html, base) {
  const found = new Set();
  const re = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1];
    if (!url.startsWith(base)) continue;
    const rel = url.slice(base.length).split(/[?#]/)[0];
    if (rel) found.add(rel);
  }
  return [...found].sort();
}

/** Build the precache URL list (absolute, with `base`) always including the shell entry URLs. */
export function buildPrecacheList(assetPaths, base) {
  return [base, `${base}index.html`, ...assetPaths.map((p) => `${base}${p}`)];
}

/** Stable short version hash from [path, bytes] pairs. */
export function versionHash(entries) {
  const h = createHash('sha256');
  for (const [path, bytes] of [...entries].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    h.update(path);
    h.update('\0');
    h.update(bytes);
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

/** Fill the template placeholders. */
export function renderSw(template, { version, precache, base }) {
  return template
    .replaceAll('__VERSION__', version)
    .replaceAll('__BASE__', base)
    .replace('__PRECACHE__', JSON.stringify(precache, null, 2));
}
