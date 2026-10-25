// The local model (wllama, compat build, 1 thread, CPU). Loaded lazily: the wllama code and wasm are a separate
// chunk that the main screen never waits for. Shards come from our own Pages site; wllama keeps them in its cache
// (OPFS), so only the first load downloads ~360 MB.
import { MODEL } from '../config';
import type { Kind } from '../parser/types';
import { buildMessages, readKind, RESPONSE_SCHEMA } from './prompt';

export interface Engine {
  /** The kind the model reads in the note, or null when its answer is not valid. */
  classify(text: string): Promise<Kind | null>;
  exit(): Promise<void>;
}

export type Progress = (loaded: number, total: number) => void;

/** First shard URL; wllama finds the other `-0000N-of-0000M` shards by itself. */
export function firstShardUrl(base: string = import.meta.env.BASE_URL): string {
  return `${base}model/${MODEL.firstShard}`;
}

/** `onDownloaded` fires when the shards are in the cache (downloaded or already there), before they go into memory. */
export async function loadEngine(onProgress?: Progress, onDownloaded?: () => void): Promise<Engine> {
  const [{ Wllama, LoggerWithoutDebug }, wasm, compatWasm, compatWorker] = await Promise.all([
    import('@wllama/wllama/esm/index.js'),
    import('@wllama/wllama/esm/wasm/wllama.wasm?url'),
    import('@wllama/wllama-compat/wasm/wllama.wasm?url'),
    import('@wllama/wllama-compat/wasm/wllama.js?raw'),
  ]);
  const wllama = new Wllama({ default: wasm.default }, { logger: LoggerWithoutDebug });
  wllama.setCompat({ wasm: compatWasm.default, worker: { code: compatWorker.default } });
  // Two steps instead of loadModelFromUrl: a failed download is only a network problem, while the memory-heavy load
  // is the step iOS may kill the page in (the refiner's `loading` flag covers only that one).
  const model = await wllama.modelManager.getModelOrDownload({ url: new URL(firstShardUrl(), location.href).href }, {
    progressCallback: ({ loaded, total }: { loaded: number; total: number }) => onProgress?.(loaded, total),
  });
  onDownloaded?.();
  await wllama.loadModel(model, { n_threads: 1, n_gpu_layers: 0, n_ctx: MODEL.contextTokens });
  return {
    async classify(text) {
      const res = await wllama.createChatCompletion({
        messages: buildMessages(text),
        max_tokens: MODEL.maxTokens,
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: { name: 'note', schema: RESPONSE_SCHEMA, strict: true } },
        ...(MODEL.noThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
        cache_prompt: true,
      });
      return readKind(res.choices[0]?.message?.content);
    },
    exit: () => wllama.exit(),
  };
}
