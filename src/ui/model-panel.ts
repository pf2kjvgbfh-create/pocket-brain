// «Настройки» → блок «Умный разбор»: the local model on/off (OFF by default: Safari cannot tell Wi-Fi from mobile data,
// so the ~360 MB download only starts when the owner taps the button).
import { MODEL } from '../config';
import type { Refiner, ModelFlags } from '../model/refiner';
import { h } from './dom';

export interface ModelPanelDeps {
  refiner: Refiner;
  flags: ModelFlags;
  /** Download progress of the current load, 0–100, or null when nothing is loading. */
  subscribeProgress(fn: (pct: number | null) => void): void;
}

export function renderModelPanel({ refiner, flags, subscribeProgress }: ModelPanelDeps): HTMLElement {
  const state = h('p', { class: 'backup-status', role: 'status', 'data-testid': 'model-state' });
  const button = h('button', { type: 'button', class: 'btn', 'data-action': 'model-toggle' });
  let busy = false;
  let failed = false;

  const paint = (pct: number | null = null): void => {
    button.disabled = busy;
    if (busy) {
      state.textContent = pct === null ? 'Загружаю…' : `Скачиваю… ${pct}%`;
      button.textContent = 'Скачиваю…';
    } else if (flags.get('enabled')) {
      state.textContent = 'Включён: уточняю непонятные фразы в фоне.';
      button.textContent = 'Выключить';
    } else if (failed) {
      state.textContent = 'Не скачалось: нет интернета. Попробуй ещё раз, лучше по Wi-Fi.';
      button.textContent = `Скачать и включить (${MODEL.sizeMb} МБ)`;
    } else if (flags.get('crashed')) {
      state.textContent = 'Мозг отключён: телефон не потянул.';
      button.textContent = 'Попробовать снова';
    } else {
      state.textContent = 'Выключен. Всё и так записывается по правилам.';
      button.textContent = `Скачать и включить (${MODEL.sizeMb} МБ)`;
    }
  };

  subscribeProgress((pct) => {
    if (busy) paint(pct);
  });

  button.addEventListener('click', () => {
    if (flags.get('enabled')) {
      flags.set('enabled', false);
      paint();
      return;
    }
    flags.set('crashed', false);
    flags.set('enabled', true);
    failed = false;
    busy = true;
    paint();
    refiner
      .load()
      .then(() => refiner.run())
      .catch(() => {
        // Memory: the refiner already turned the model off and marked it crashed. Download: turn it off here, so it
        // does not quietly try again later on mobile data; the owner taps again when on Wi-Fi.
        if (flags.get('crashed')) return;
        flags.set('enabled', false);
        failed = true;
      })
      .finally(() => {
        busy = false;
        paint();
      });
  });

  paint();
  return h(
    'section',
    { class: 'backup', 'data-testid': 'model' },
    h('h2', {}, 'Умный разбор'),
    h('p', { class: 'hint' }, `Помогает с короткими фразами, которые правила не поняли. Скачивается один раз, ${MODEL.sizeMb} МБ — лучше по Wi-Fi.`),
    state,
    button,
  );
}
