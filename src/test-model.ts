// Step 5: wllama (compat build, 1 thread, CPU) tokens/sec for one candidate model.
// All wasm files are bundled into our own build (served from our origin), nothing from a CDN.
// Only Hugging Face is contacted, and only for the model file itself.
import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';
import compatWasmUrl from '@wllama/wllama-compat/wasm/wllama.wasm?url';
import compatWorkerCode from '@wllama/wllama-compat/wasm/wllama.js?raw';
import { saveRow, type StepId } from './test-store';

export interface Candidate {
  name: string;
  url: string;
  licence: string;
}

export const CANDIDATES: Record<'5a' | '5b', Candidate> = {
  '5a': {
    name: 'Qwen2.5-0.5B-Instruct Q4_K_M',
    url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf',
    licence: 'Apache-2.0',
  },
  '5b': {
    name: 'Qwen3-0.6B Q4_K_M',
    url: 'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf',
    licence: 'Apache-2.0',
  },
};

/** Fixed prompt: the same for every model and every run, so the numbers are comparable. */
export const FIXED_PROMPT =
  'Преврати фразу в JSON с полями kind, title, due.\n' +
  'Фраза: напомни завтра в 19:00 позвонить маме\n' +
  'JSON:';

const MAX_TOKENS = 64;

type Notify = () => void;

export async function runModelStep(id: '5a' | '5b', notify: Notify): Promise<void> {
  const cand = CANDIDATES[id];
  // Recorded BEFORE any download or allocation: if iOS kills the tab, the table says where.
  saveRow(id as StepId, { state: 'started', value: 'загрузка начата', detail: cand.name });
  notify();
  const { Wllama, LoggerWithoutDebug } = await import('@wllama/wllama/esm/index.js');
  const wllama = new Wllama({ default: wasmUrl }, { logger: LoggerWithoutDebug });
  wllama.setCompat({ wasm: compatWasmUrl, worker: { code: compatWorkerCode } });
  const t0 = performance.now();
  let lastPct = -1;
  try {
    await wllama.loadModelFromUrl(cand.url, {
      n_threads: 1,
      n_gpu_layers: 0,
      n_ctx: 512,
      progressCallback: ({ loaded, total }: { loaded: number; total: number }) => {
        const pct = total > 0 ? Math.floor((loaded / total) * 100) : 0;
        if (pct === lastPct) return;
        lastPct = pct;
        saveRow(id as StepId, { state: 'started', value: `скачано ${pct}%`, detail: cand.name });
        notify();
      },
    });
    const loadS = (performance.now() - t0) / 1000;
    saveRow(id as StepId, {
      state: 'started',
      value: `загружено за ${loadS.toFixed(1)} с`,
      detail: 'считаю токены…',
    });
    notify();
    const t1 = performance.now();
    const res = await wllama.createCompletion({
      prompt: FIXED_PROMPT,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      stream: false,
    });
    const genS = (performance.now() - t1) / 1000;
    const tokens = res.usage.completion_tokens;
    const reported = res.timings?.predicted_per_second;
    const wall = genS > 0 ? tokens / genS : 0;
    const tps = reported && reported > 0 ? reported : wall;
    const text = res.choices[0]?.text ?? '';
    saveRow(id as StepId, {
      state: 'ok',
      value: `${tps.toFixed(1)} ток/с`,
      detail: [
        cand.name,
        `загрузка: ${loadS.toFixed(1)} с`,
        `токенов: ${tokens}, ток/с по часам страницы: ${wall.toFixed(1)}`,
        `ответ: ${text.slice(0, 120).replace(/\s+/g, ' ')}`,
      ].join('\n'),
    });
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    saveRow(id as StepId, { state: 'fail', value: 'ошибка', detail: `${cand.name}\n${msg.slice(0, 200)}` });
  } finally {
    try {
      await wllama.exit();
    } catch {
      // already stopped
    }
  }
}

/** Remove downloaded model files from the browser cache (they take 400-500 MB each). */
export async function clearModelCache(): Promise<void> {
  const { Wllama } = await import('@wllama/wllama/esm/index.js');
  const w = new Wllama({ default: wasmUrl });
  await w.cacheManager.clear();
}
