// GitHub Pages sends the shards gzip-compressed (Content-Encoding: gzip), and wllama 3.8.1 stores the COMPRESSED
// Content-Length as `originalSize` of the file it wrote decompressed. On the next start the cached model is then
// «invalid» (originalSize !== size) and wllama deletes it and downloads 357 MB again — on every start.
// Fix: before (and after) loading, set `originalSize` to the real size — only when the file on disk has exactly the
// known size of that shard, so a partial file still counts as partial and is downloaded again.
import type { CacheManager } from '@wllama/wllama/esm/index.js';

type ShardCache = Pick<CacheManager, 'list' | 'writeMetadata'>;

/** `sizes`: shard file name -> exact bytes (`MODEL.shardBytes`). Cache keys are `${sha1(url)}_${fileName}`. */
export async function fixCompressedSizes(cache: ShardCache, sizes: Record<string, number>): Promise<void> {
  for (const entry of await cache.list()) {
    const fileName = entry.name.slice(entry.name.indexOf('_') + 1);
    const expected = sizes[fileName];
    const { metadata } = entry;
    // No originalURL = no metadata written = the download never finished.
    if (expected === undefined || !metadata.originalURL || entry.size !== expected || metadata.originalSize === expected) continue;
    await cache.writeMetadata(entry.name, { ...metadata, originalSize: expected });
  }
}
