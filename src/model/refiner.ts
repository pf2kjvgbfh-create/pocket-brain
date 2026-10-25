// Background queue: records the rules were unsure about (refine: 'pending') go to the local model one by one.
// Never blocks saving (invariant 4): it runs after the record is already stored. Invariant 10: a `loading` flag is set
// once the download is done and the model goes into memory, cleared after; found set at startup = iOS killed the page
// → the model is turned off. A failed or interrupted download is not a crash: the model stays on and tries again.
import type { RecordRow, WalletRow } from '../db/types';
import type { Engine } from './engine';
import { refineRecord } from './refine';

export interface ModelFlags {
  get(key: 'enabled' | 'loading' | 'crashed'): boolean;
  set(key: 'enabled' | 'loading' | 'crashed', value: boolean): void;
}

export interface RefinerHost {
  listRecords(): Promise<RecordRow[]>;
  getRecord(id: string): Promise<RecordRow | undefined>;
  putRecord(r: RecordRow): Promise<void>;
  lastWalletId(): Promise<string | undefined>;
  wallets(): WalletRow[];
  now(): Date;
  /** Calls `downloaded()` when the files are there (from the network or the cache), right before the memory-heavy step. */
  loadEngine(downloaded: () => void): Promise<Engine>;
  flags: ModelFlags;
  /** A record changed its kind (for the «Уточнил: …» toast and the lists). */
  onRefined(before: RecordRow, after: RecordRow): void;
}

export interface Refiner {
  /** Process every pending record; a call while one runs joins it, and records saved meanwhile are taken too. */
  run(): Promise<void>;
  /** At startup: true if a model load was killed last time (the model is then turned off). */
  recoverAfterCrash(): boolean;
  /** Load the model now (the Settings switch), so the download starts at once. */
  load(): Promise<Engine>;
}

const isPending = (r: RecordRow): boolean => r.refine === 'pending' && !r.deleted && r.kind === 'idea';

export function createRefiner(host: RefinerHost): Refiner {
  const { flags } = host;
  let engine: Promise<Engine> | null = null;
  let running: Promise<void> | null = null;
  let again = false;

  function load(): Promise<Engine> {
    engine ??= (async () => {
      let heavy = false;
      try {
        const e = await host.loadEngine(() => {
          heavy = true;
          flags.set('loading', true);
        });
        flags.set('loading', false);
        return e;
      } catch (err) {
        flags.set('loading', false);
        if (heavy) {
          flags.set('enabled', false);
          flags.set('crashed', true);
        }
        engine = null;
        throw err;
      }
    })();
    return engine;
  }

  async function refineOne(e: Engine, id: string): Promise<void> {
    const first = await host.getRecord(id);
    if (!first || !isPending(first)) return;
    const kind = await e.classify(first.raw_text);
    const lastWalletId = await host.lastWalletId();
    // Read again, right before the write: the owner may have edited or undone the record while the model was thinking.
    const fresh = await host.getRecord(id);
    if (!fresh || !isPending(fresh)) return;
    const out = refineRecord({ record: fresh, kind, wallets: host.wallets(), lastWalletId, now: host.now() });
    if (out) {
      await host.putRecord(out);
      host.onRefined(fresh, out);
      return;
    }
    const { refine: _done, ...rest } = fresh;
    await host.putRecord(rest);
  }

  /** One pass over the records pending now; the ids it tried, so a record that failed is not retried in a loop. */
  async function pass(tried: Set<string>): Promise<void> {
    const pending = (await host.listRecords()).filter((r) => isPending(r) && !tried.has(r.id));
    if (pending.length === 0) return;
    let e: Engine;
    try {
      e = await load();
    } catch (err) {
      console.warn('model load failed', err instanceof Error ? err.name : 'error');
      return;
    }
    for (const r of pending) {
      if (!flags.get('enabled')) return;
      tried.add(r.id);
      try {
        await refineOne(e, r.id);
      } catch (err) {
        // This record keeps its flag (the next start tries again); the others still go.
        console.warn('model refine failed', err instanceof Error ? err.name : 'error');
      }
    }
  }

  async function work(): Promise<void> {
    const tried = new Set<string>();
    do {
      again = false;
      if (!flags.get('enabled')) return;
      await pass(tried);
    } while (again);
  }

  return {
    run() {
      if (running) {
        again = true;
        return running;
      }
      running = work()
        .catch((err) => console.warn('model queue failed', err instanceof Error ? err.name : 'error'))
        .finally(() => {
          running = null;
        });
      return running;
    },
    recoverAfterCrash() {
      if (!flags.get('loading')) return false;
      flags.set('loading', false);
      flags.set('enabled', false);
      flags.set('crashed', true);
      return true;
    },
    load,
  };
}
