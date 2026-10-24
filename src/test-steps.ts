// Steps 1-4 of the phone test. Each step records its result via saveRow BEFORE any risky next action.
import { mb, saveRow } from './test-store';

type Notify = () => void;

interface GpuAdapterLike {
  limits: Record<string, number>;
  features: { has(name: string): boolean };
  info?: Record<string, unknown>;
  requestAdapterInfo?: () => Promise<Record<string, unknown>>;
}

/** Step 1: WebGPU adapter limits. Information only: no WebGPU is "нет", not a failure. */
export async function step1(): Promise<void> {
  saveRow('1', { state: 'started', value: 'проверяю…' });
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<GpuAdapterLike | null> } }).gpu;
  if (!gpu) {
    saveRow('1', { state: 'ok', value: 'нет', detail: 'WebGPU в этом браузере недоступен (это не ошибка)' });
    return;
  }
  const adapter = await gpu.requestAdapter();
  if (!adapter) {
    saveRow('1', { state: 'ok', value: 'нет', detail: 'WebGPU есть, но адаптер не выдан (это не ошибка)' });
    return;
  }
  const l = adapter.limits;
  const info = adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
  const f16 = adapter.features.has('shader-f16') ? 'да' : 'нет';
  const sub = adapter.features.has('subgroups') ? 'да' : 'нет';
  const detail = [
    `maxBufferSize: ${mb(l.maxBufferSize)}`,
    `maxStorageBufferBindingSize: ${mb(l.maxStorageBufferBindingSize)}`,
    `maxComputeWorkgroupStorageSize: ${l.maxComputeWorkgroupStorageSize} Б`,
    `shader-f16: ${f16}; subgroups: ${sub}`,
    `adapter.info: ${JSON.stringify(info)}`,
  ].join('\n');
  saveRow('1', { state: 'ok', value: `буфер до ${mb(l.maxBufferSize)}`, detail });
}

/** Step 2: cross-origin isolation (GitHub Pages cannot set COOP/COEP, expected "false"). */
export function step2(): void {
  const sab = typeof SharedArrayBuffer;
  saveRow('2', {
    state: 'ok',
    value: `isolated=${String(self.crossOriginIsolated)}`,
    detail: `crossOriginIsolated: ${String(self.crossOriginIsolated)}\ntypeof SharedArrayBuffer: ${sab}`,
  });
}

/** Step 3: storage estimate and persist(). */
export async function step3(): Promise<void> {
  saveRow('3', { state: 'started', value: 'проверяю…' });
  const s = navigator.storage;
  if (!s || !s.estimate) {
    saveRow('3', { state: 'ok', value: 'нет', detail: 'navigator.storage.estimate недоступен' });
    return;
  }
  const est = await s.estimate();
  const quota = est.quota ?? 0;
  const usage = est.usage ?? 0;
  saveRow('3', { state: 'started', value: `квота ${mb(quota)}`, detail: 'спрашиваю persist()…' });
  let persisted = 'не поддерживается';
  if (s.persist) persisted = String(await s.persist());
  saveRow('3', {
    state: 'ok',
    value: `квота ${mb(quota)}`,
    detail: `usage: ${mb(usage)}\nquota: ${mb(quota)}\npersist(): ${persisted}`,
  });
}

const CHUNK_MB = 128;
const DEFAULT_CAP_MB = 4096;

export function capFromQuery(search: string): number {
  const n = Number(new URLSearchParams(search).get('cap'));
  return Number.isFinite(n) && n >= CHUNK_MB ? Math.floor(n) : DEFAULT_CAP_MB;
}

/**
 * Step 4: allocate ArrayBuffers in 128 MB chunks, EACH one filled (zero pages are not counted by iOS jetsam),
 * keeping references. The attempted size is recorded BEFORE every allocation.
 */
export async function step4(capMb: number, notify: Notify): Promise<void> {
  const chunks: ArrayBuffer[] = [];
  let okMb = 0;
  let endNote = '';
  try {
    for (let next = CHUNK_MB; next <= capMb; next += CHUNK_MB) {
      saveRow('4', {
        state: 'started',
        value: `ок ${okMb} МБ`,
        detail: `пробую выделить до ${next} МБ (если страница закрылась, предел где-то здесь)`,
      });
      notify();
      await new Promise((r) => setTimeout(r, 0)); // let the browser paint the progress
      const buf = new ArrayBuffer(CHUNK_MB * 1024 * 1024);
      new Uint8Array(buf).fill(1);
      chunks.push(buf);
      okMb = next;
    }
    endNote = `дошёл до верхней границы теста (${capMb} МБ), ошибок нет`;
  } catch (e) {
    endNote = `остановилось на ${okMb + CHUNK_MB} МБ: ${e instanceof Error ? e.name : String(e)}`;
  } finally {
    chunks.length = 0;
  }
  saveRow('4', { state: 'ok', value: `${okMb} МБ`, detail: endNote });
}
