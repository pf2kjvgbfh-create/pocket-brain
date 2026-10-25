// Stage 5, found on the live site: GitHub Pages sends the shards gzip-compressed, and wllama stores the COMPRESSED
// Content-Length as the file's size. The cached copy then never validates and 357 MB are downloaded on every start.
import { describe, expect, it } from 'vitest';
import { fixCompressedSizes } from '../src/model/cache-fix';

const SIZES = { 'm-00001-of-00002.gguf': 1000, 'm-00002-of-00002.gguf': 800 };
const URL1 = 'https://example.test/pocket-brain/model/m-00001-of-00002.gguf';

type Entry = { name: string; size: number; metadata: { originalSize: number; originalURL: string; etag: string } };

function fakeCache(entries: Entry[]) {
  const written: [string, Entry['metadata']][] = [];
  return {
    written,
    list: async () => entries,
    writeMetadata: async (name: string, metadata: Entry['metadata']) => {
      written.push([name, metadata]);
    },
  };
}

describe('fixCompressedSizes', () => {
  it('a complete shard recorded with the compressed size gets its real size', async () => {
    const c = fakeCache([{ name: 'abc_m-00001-of-00002.gguf', size: 1000, metadata: { originalSize: 930, originalURL: URL1, etag: 'x' } }]);
    await fixCompressedSizes(c, SIZES);
    expect(c.written).toEqual([['abc_m-00001-of-00002.gguf', { originalSize: 1000, originalURL: URL1, etag: 'x' }]]);
  });

  it('a partial file (size differs from the known one) is left alone, so wllama downloads it again', async () => {
    const c = fakeCache([{ name: 'abc_m-00001-of-00002.gguf', size: 600, metadata: { originalSize: 930, originalURL: URL1, etag: 'x' } }]);
    await fixCompressedSizes(c, SIZES);
    expect(c.written).toEqual([]);
  });

  it('records that are already right, files without metadata and other files are not touched', async () => {
    const c = fakeCache([
      { name: 'abc_m-00002-of-00002.gguf', size: 800, metadata: { originalSize: 800, originalURL: URL1, etag: '' } },
      { name: 'def_m-00001-of-00002.gguf', size: 1000, metadata: { originalSize: 1000, originalURL: '', etag: '' } },
      { name: 'ghi_other.gguf', size: 1000, metadata: { originalSize: 5, originalURL: 'https://example.test/other.gguf', etag: '' } },
    ]);
    await fixCompressedSizes(c, SIZES);
    expect(c.written).toEqual([]);
  });
});
