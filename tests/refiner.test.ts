// Stage 5: the background queue that sends «unsure» records to the local model. Fake engine and an in-memory store.
import { describe, expect, it } from 'vitest';
import { DEFAULT_WALLETS } from '../src/config';
import type { RecordRow, WalletRow } from '../src/db/types';
import type { Engine } from '../src/model/engine';
import { createRefiner, type RefinerHost, type ModelFlags } from '../src/model/refiner';
import type { Kind } from '../src/parser/types';

const NOW = new Date('2026-10-22T09:30:00Z');
const wallets: WalletRow[] = DEFAULT_WALLETS.map((w) => ({ id: w.id, name: w.name, hidden: false, start_balance_minor: 0 }));
const rec = (id: string, text: string, over: Partial<RecordRow> = {}): RecordRow => ({
  id, kind: 'idea', raw_text: text, fields: { title: text }, wallet_id: null, due_utc: null,
  created_utc: '2026-10-22T09:00:00.000Z', updated_utc: '2026-10-22T09:00:00.000Z', deleted: false, refine: 'pending', ...over,
});

function memFlags(init: Partial<Record<keyof ModelFlags, boolean>> = {}): ModelFlags & { state: Record<string, boolean> } {
  const state: Record<string, boolean> = { enabled: false, loading: false, crashed: false, ...init };
  return {
    state,
    get: (k) => state[k],
    set: (k, v) => {
      state[k] = v;
    },
  };
}

interface Opts {
  flags?: ReturnType<typeof memFlags>;
  /** 'download': the shards never arrived (network); 'memory': the download finished, loading into memory failed. */
  failLoad?: 'download' | 'memory';
  /** Called inside classify, before the answer: lets a test save a record or change one while the model thinks. */
  during?: (text: string) => void;
}

function setup(rows: RecordRow[], answers: Record<string, Kind | null>, opts: Opts = {}) {
  const store = new Map(rows.map((r) => [r.id, r]));
  const refined: [RecordRow, RecordRow][] = [];
  let loads = 0;
  let loadingDuringDownload: boolean | undefined;
  const flags = opts.flags ?? memFlags({ enabled: true });
  const engine: Engine = {
    classify: async (text) => {
      opts.during?.(text);
      if (!(text in answers)) throw new Error('unexpected phrase ' + text);
      return answers[text];
    },
    exit: async () => {},
  };
  const host: RefinerHost = {
    listRecords: async () => [...store.values()],
    getRecord: async (id) => store.get(id),
    putRecord: async (r) => {
      store.set(r.id, r);
    },
    lastWalletId: async () => 'silver',
    wallets: () => wallets,
    now: () => NOW,
    loadEngine: async (downloaded) => {
      loads += 1;
      loadingDuringDownload = flags.state.loading;
      if (opts.failLoad === 'download') throw new Error('network');
      downloaded();
      if (opts.failLoad === 'memory') throw new Error('out of memory');
      return engine;
    },
    flags,
    onRefined: (before, after) => refined.push([before, after]),
  };
  return { store, refined, host, flags, loads: () => loads, loadingDuringDownload: () => loadingDuringDownload };
}

describe('refiner', () => {
  it('model off: nothing is loaded, nothing changes', async () => {
    const t = setup([rec('a', 'такси 650')], {}, { flags: memFlags({ enabled: false }) });
    await createRefiner(t.host).run();
    expect(t.loads()).toBe(0);
    expect(t.store.get('a')?.refine).toBe('pending');
  });

  it('a pending idea with an amount becomes an expense; the flag is cleared; the UI is told', async () => {
    const t = setup([rec('a', 'репетитор 2000 за урок')], { 'репетитор 2000 за урок': 'expense' });
    await createRefiner(t.host).run();
    const a = t.store.get('a');
    expect(a?.kind).toBe('expense');
    expect(a?.fields.amount_minor).toBe(200000);
    expect(a?.wallet_id).toBe('silver');
    expect(a?.refine).toBeUndefined();
    expect(t.refined).toHaveLength(1);
    expect(t.refined[0][0].kind).toBe('idea');
  });

  it('the model says idea (or nothing usable): the record stays, only the flag goes, the UI is not told', async () => {
    const t = setup([rec('a', 'мысль про отпуск'), rec('b', 'купить подарок')], { 'мысль про отпуск': 'idea', 'купить подарок': 'expense' });
    await createRefiner(t.host).run();
    expect(t.store.get('a')).toMatchObject({ kind: 'idea' });
    expect(t.store.get('a')?.refine).toBeUndefined();
    expect(t.store.get('b')).toMatchObject({ kind: 'idea' });
    expect(t.store.get('b')?.refine).toBeUndefined();
    expect(t.refined).toHaveLength(0);
  });

  it('records without the flag, deleted ones, and ones the owner changed meanwhile are skipped', async () => {
    const t = setup([rec('a', 'такси 650', { refine: undefined }), rec('b', 'такси 700', { deleted: true })], {});
    await createRefiner(t.host).run();
    expect(t.loads()).toBe(0);
  });

  it('the model is loaded once for many records, and the loading flag is cleared after success', async () => {
    const t = setup([rec('a', 'кофе 300 утром'), rec('b', 'чай 200 вечером')], { 'кофе 300 утром': 'expense', 'чай 200 вечером': 'expense' });
    await createRefiner(t.host).run();
    expect(t.loads()).toBe(1);
    expect(t.flags.state.loading).toBe(false);
  });

  it('loading into memory fails: the model is turned off and marked crashed; records keep their flag', async () => {
    const t = setup([rec('a', 'такси 650')], {}, { failLoad: 'memory' });
    await createRefiner(t.host).run();
    expect(t.flags.state).toMatchObject({ enabled: false, crashed: true, loading: false });
    expect(t.store.get('a')?.refine).toBe('pending');
  });

  it('the download fails (network): NOT a crash — the model stays on and the next run tries again', async () => {
    const t = setup([rec('a', 'такси 650')], {}, { failLoad: 'download' });
    const r = createRefiner(t.host);
    await r.run();
    expect(t.flags.state).toMatchObject({ enabled: true, crashed: false, loading: false });
    expect(t.store.get('a')?.refine).toBe('pending');
    await r.run();
    expect(t.loads()).toBe(2);
  });

  it('the «loading» flag is not set during the download (closing the tab mid-download is not a crash)', async () => {
    const t = setup([rec('a', 'репетитор 2000 за урок')], { 'репетитор 2000 за урок': 'expense' });
    await createRefiner(t.host).run();
    expect(t.loadingDuringDownload()).toBe(false);
    expect(t.flags.state.loading).toBe(false);
  });

  it('a record saved while the model works on another one is processed in the same run', async () => {
    let r: ReturnType<typeof createRefiner> | undefined;
    const t = setup([rec('a', 'репетитор 2000 за урок')], { 'репетитор 2000 за урок': 'expense', 'массаж 3000 в субботу': 'expense' }, {
      during: (text) => {
        if (text !== 'репетитор 2000 за урок') return;
        t.store.set('c', rec('c', 'массаж 3000 в субботу'));
        void r?.run(); // what refresh() does after a save
      },
    });
    r = createRefiner(t.host);
    await r.run();
    expect(t.store.get('c')?.refine).toBeUndefined();
    expect(t.refined).toHaveLength(2);
  });

  it('one record the model fails on does not block the others', async () => {
    const t = setup([rec('a', 'странная фраза 100'), rec('b', 'репетитор 2000 за урок')], { 'репетитор 2000 за урок': 'expense' });
    await createRefiner(t.host).run();
    expect(t.store.get('a')?.refine).toBe('pending');
    expect(t.store.get('b')?.kind).toBe('expense');
  });

  it('startup after a killed load (flag still set): the model is turned off and marked crashed, nothing loads', async () => {
    const flags = memFlags({ enabled: true, loading: true });
    const t = setup([rec('a', 'такси 650')], {}, { flags });
    const r = createRefiner(t.host);
    expect(r.recoverAfterCrash()).toBe(true);
    await r.run();
    expect(t.loads()).toBe(0);
    expect(flags.state).toMatchObject({ enabled: false, crashed: true, loading: false });
  });

  it('two runs at once do the work once', async () => {
    const t = setup([rec('a', 'репетитор 2000 за урок')], { 'репетитор 2000 за урок': 'expense' });
    const r = createRefiner(t.host);
    await Promise.all([r.run(), r.run()]);
    expect(t.refined).toHaveLength(1);
  });
});
