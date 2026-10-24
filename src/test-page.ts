// Phone test page UI: one button per step, a big table "шаг — число — итог" restored from localStorage.
import { clearModelCache, runModelStep } from './test-model';
import { capFromQuery, step1, step2, step3, step4 } from './test-steps';
import { STEP_IDS, STEP_TITLES, clearRows, loadRows, saveRow, type StepId } from './test-store';

const tbody = document.querySelector<HTMLTableSectionElement>('#results tbody')!;
const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#buttons button, #reset, #clear-models'));
let running: StepId | null = null;

function statusCell(id: StepId, state: string | undefined): [string, string] {
  if (!state) return ['—', 'st-none'];
  if (state === 'ok') return ['ок', 'st-ok'];
  if (state === 'fail') return ['упало', 'st-fail'];
  if (running === id) return ['идёт…', 'st-run'];
  return ['упало (страница закрылась)', 'st-fail'];
}

function render(): void {
  const rows = loadRows();
  tbody.replaceChildren(
    ...STEP_IDS.map((id) => {
      const row = rows[id];
      const tr = document.createElement('tr');
      const [status, cls] = statusCell(id, row?.state);
      const tdTitle = document.createElement('td');
      tdTitle.textContent = STEP_TITLES[id];
      const tdValue = document.createElement('td');
      tdValue.textContent = row?.value ?? '—';
      if (row?.detail) {
        const d = document.createElement('span');
        d.className = 'detail';
        d.textContent = row.detail;
        tdValue.append(d);
      }
      const tdStatus = document.createElement('td');
      tdStatus.textContent = status;
      tdStatus.className = cls;
      tr.dataset.step = id;
      tr.dataset.state = row?.state ?? 'none';
      tr.append(tdTitle, tdValue, tdStatus);
      return tr;
    }),
  );
}

function setBusy(busy: boolean): void {
  for (const b of buttons) b.disabled = busy;
}

async function runStep(id: StepId): Promise<void> {
  running = id;
  setBusy(true);
  render();
  try {
    if (id === '1') await step1();
    else if (id === '2') step2();
    else if (id === '3') await step3();
    else if (id === '4') await step4(capFromQuery(location.search), render);
    else await runModelStep(id, render);
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    saveRow(id, { state: 'fail', value: 'ошибка', detail: msg.slice(0, 200) });
  } finally {
    running = null;
    setBusy(false);
    render();
  }
}

function describeMode(): string {
  const standalone =
    (navigator as unknown as { standalone?: boolean }).standalone === true ||
    matchMedia('(display-mode: standalone)').matches;
  const where = standalone ? 'открыто с иконки «Домой»' : 'открыто во вкладке браузера';
  return `Режим: ${where}. Запусти тест дважды: во вкладке и с иконки «Домой».`;
}

document.querySelector('#mode')!.textContent = describeMode();

document.querySelector('#buttons')!.addEventListener('click', (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-step]');
  if (!btn || running) return;
  void runStep(btn.dataset.step as StepId);
});

document.querySelector('#reset')!.addEventListener('click', () => {
  clearRows();
  render();
});

document.querySelector('#clear-models')!.addEventListener('click', async () => {
  setBusy(true);
  try {
    await clearModelCache();
  } finally {
    setBusy(false);
  }
});

render();
