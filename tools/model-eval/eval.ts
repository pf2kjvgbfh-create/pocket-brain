// Stage-5 model evaluation page (dev only, never built or deployed). Driven by tools/model-eval/run.mjs through
// Playwright: loads one candidate with wllama (1 thread) and classifies phrases with the app's own prompt.
import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';
import compatWasmUrl from '@wllama/wllama-compat/wasm/wllama.wasm?url';
import compatWorkerCode from '@wllama/wllama-compat/wasm/wllama.js?raw';
import { Wllama, LoggerWithoutDebug } from '@wllama/wllama/esm/index.js';
import { buildMessages, readKind, RESPONSE_SCHEMA } from '../../src/model/prompt';

interface Phrase {
  text: string;
  kind: string;
}

interface EvalOptions {
  shardUrls: string[];
  phrases: Phrase[];
  /** Qwen3: turn off the <think> block. */
  noThinking: boolean;
  /** 0 = CPU only; 99 = every layer on WebGPU. */
  gpuLayers: number;
}

let wllama: Wllama | null = null;

async function load(shardUrls: string[], gpuLayers: number): Promise<number> {
  if (wllama) await wllama.exit();
  wllama = new Wllama({ default: wasmUrl }, { logger: LoggerWithoutDebug });
  wllama.setCompat({ wasm: compatWasmUrl, worker: { code: compatWorkerCode } });
  const t0 = performance.now();
  await wllama.loadModelFromUrl(shardUrls[0], { n_threads: 1, n_gpu_layers: gpuLayers, n_ctx: 1024 });
  return (performance.now() - t0) / 1000;
}

async function classify(text: string, noThinking: boolean) {
  const t0 = performance.now();
  const res = await (wllama as Wllama).createChatCompletion({
    messages: buildMessages(text),
    max_tokens: 24,
    temperature: 0,
    response_format: { type: 'json_schema', json_schema: { name: 'note', schema: RESPONSE_SCHEMA, strict: true } },
    ...(noThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    cache_prompt: true,
  });
  const seconds = (performance.now() - t0) / 1000;
  const content = res.choices[0]?.message?.content ?? '';
  const t = (res as { timings?: { predicted_per_second?: number; prompt_per_second?: number; prompt_n?: number } }).timings;
  return {
    content,
    kind: readKind(content),
    seconds,
    completionTokens: res.usage?.completion_tokens ?? 0,
    promptTokens: res.usage?.prompt_tokens ?? 0,
    tps: t?.predicted_per_second ?? null,
    promptTps: t?.prompt_per_second ?? null,
    promptN: t?.prompt_n ?? null,
  };
}

async function runEval(opts: EvalOptions) {
  const loadSeconds = await load(opts.shardUrls, opts.gpuLayers);
  const rows = [];
  for (const p of opts.phrases) {
    try {
      rows.push({ text: p.text, expected: p.kind, ...(await classify(p.text, opts.noThinking)) });
    } catch (e) {
      rows.push({ text: p.text, expected: p.kind, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { loadSeconds, webgpu: (wllama as Wllama).isSupportWebGPU(), rows };
}

/** Load only (the files are in the browser cache after a first run): measures load-from-cache time. */
async function loadOnly(shardUrls: string[], gpuLayers: number): Promise<number> {
  return load(shardUrls, gpuLayers);
}

/** One phrase at a time, so the runner can save after each one (a killed run keeps what it measured). */
async function classifyOne(text: string, noThinking: boolean) {
  return classify(text, noThinking);
}

Object.assign(window, { runEval, loadOnly, classifyOne });
document.body.dataset.ready = '1';
