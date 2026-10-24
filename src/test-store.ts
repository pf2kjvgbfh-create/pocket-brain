// Persistent results of the phone test. Every write goes to localStorage synchronously,
// so after a tab kill (iOS jetsam gives no error) the table shows how far the test got.

export type StepState = 'started' | 'ok' | 'fail';

export interface StepRow {
  state: StepState;
  /** Short value shown in the "число" column. */
  value: string;
  /** Optional multi-line details shown in small text under the value. */
  detail?: string;
  ts: number;
}

export type StepId = '1' | '2' | '3' | '4' | '5a' | '5b';

export const STEP_TITLES: Record<StepId, string> = {
  '1': 'Шаг 1 — видеокарта (WebGPU)',
  '2': 'Шаг 2 — общая память (SharedArrayBuffer)',
  '3': 'Шаг 3 — хранилище',
  '4': 'Шаг 4 — сколько памяти даст страница',
  '5a': 'Шаг 5а — Qwen2.5-0.5B, токенов/с',
  '5b': 'Шаг 5б — Qwen3-0.6B, токенов/с',
};

export const STEP_IDS = Object.keys(STEP_TITLES) as StepId[];

const KEY = 'pb_phone_test_v1';

type Rows = Partial<Record<StepId, StepRow>>;

export function loadRows(): Rows {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Rows) : {};
  } catch {
    return {};
  }
}

/** Write one row. Never throws: a broken localStorage must not stop the test itself. */
export function saveRow(id: StepId, row: Omit<StepRow, 'ts'>): void {
  try {
    const rows = loadRows();
    rows[id] = { ...row, ts: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    // storage unavailable (private mode / quota): the table still updates in memory
  }
}

export function clearRows(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

export function mb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} МБ`;
}
