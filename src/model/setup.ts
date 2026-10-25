// Wires the local model into the app: flags in localStorage (synchronous, so they survive iOS killing the page
// mid-load), the background refiner, the «Уточнил: …» toast and the Settings block.
import { LAST_WALLET_KEY, TOAST_SHORT_MS, UNDO_MS } from '../config';
import type { RecordRow } from '../db/types';
import type { App } from '../ui/app';
import { savedSentence } from '../ui/card-model';
import { renderModelPanel } from '../ui/model-panel';
import { hasToast, showToast } from '../ui/toast';
import { createRefiner, type ModelFlags, type Refiner } from './refiner';

const FLAG_KEYS = { enabled: 'pb_model_enabled', loading: 'pb_model_loading', crashed: 'pb_model_crashed' } as const;

/** localStorage may throw (private mode, storage off): then the model simply stays off. */
export const localFlags: ModelFlags = {
  get(key) {
    try {
      return localStorage.getItem(FLAG_KEYS[key]) === '1';
    } catch {
      return false;
    }
  },
  set(key, value) {
    try {
      if (value) localStorage.setItem(FLAG_KEYS[key], '1');
      else localStorage.removeItem(FLAG_KEYS[key]);
    } catch {
      // ignore: the model stays off
    }
  },
};

export interface ModelSetup {
  refiner: Refiner;
  panel: HTMLElement;
}

export function setupModel(app: App, flags: ModelFlags = localFlags): ModelSetup {
  const listeners: ((pct: number | null) => void)[] = [];
  const progress = (pct: number | null): void => listeners.forEach((fn) => fn(pct));

  const undo = async (before: RecordRow, after: RecordRow): Promise<void> => {
    // The owner edited (or deleted) it after the model: that edit wins, «Отменить» does nothing.
    const now = await app.db.getRecord(after.id);
    if (!now || now.deleted || now.updated_utc !== after.updated_utc) return;
    const { refine: _done, ...rest } = before;
    await app.db.putRecord({ ...rest, updated_utc: app.now().toISOString() });
    await app.refresh();
    showToast({ text: 'Отменено', ms: TOAST_SHORT_MS });
  };

  const refiner = createRefiner({
    listRecords: () => app.db.listRecords(),
    getRecord: (id) => app.db.getRecord(id),
    putRecord: (r) => app.db.putRecord(r),
    lastWalletId: () => app.db.getSetting<string>(LAST_WALLET_KEY),
    wallets: () => app.wallets,
    now: app.now,
    loadEngine: async (downloaded) => {
      const { loadEngine } = await import('./engine');
      try {
        return await loadEngine(
          // gzip from Pages: `total` is the compressed size, so `loaded` runs past it.
          (loaded, total) => progress(total > 0 ? Math.min(99, Math.floor((loaded / total) * 100)) : null),
          () => {
            downloaded();
            progress(null);
          },
        );
      } finally {
        progress(null);
      }
    },
    flags,
    onRefined: (before, after) => {
      void app.refresh();
      // Never replace a «Записал: …» toast: that would cancel its «Отменить» and the reminder that opens by itself.
      if (hasToast()) return;
      showToast({
        text: savedSentence(after, app.wallets, app.now()).replace(/^Записал/, 'Уточнил'),
        ms: UNDO_MS,
        actions: [{ label: 'Отменить', action: 'refine-undo', run: () => void undo(before, after) }],
      });
    },
  });

  if (refiner.recoverAfterCrash()) {
    showToast({ text: 'Мозг отключён: телефон не потянул. Включить снова можно в «Настройках».', ms: UNDO_MS });
  }
  const panel = renderModelPanel({ refiner, flags, subscribeProgress: (fn) => listeners.push(fn) });
  return { refiner, panel };
}
