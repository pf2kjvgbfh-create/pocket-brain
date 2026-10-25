// Stage 5: «Умный разбор» (the local model). Off by default and downloads nothing; a load that iOS killed is detected
// on the next start; the real model (Chromium only: one browser is enough for the download and the numbers) loads
// from our own site, never blocks saving and turns an unsure note into an expense / income / reminder in the background.
import { expect, test, type Page } from '@playwright/test';

const tab = (page: Page, name: string): Promise<void> => page.getByRole('tab', { name }).click();
const toast = (page: Page) => page.getByTestId('toast');

interface Row {
  raw_text: string;
  kind: string;
  refine?: string;
  deleted: boolean;
  fields: { amount_minor?: number };
  due_utc: string | null;
}

/** The live records, read straight from the app's IndexedDB. */
const rows = (page: Page): Promise<Row[]> =>
  page.evaluate(
    () =>
      new Promise<Row[]>((resolve, reject) => {
        const open = indexedDB.open('pocket-brain');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction('records').objectStore('records').getAll();
          all.onsuccess = () => {
            resolve((all.result as Row[]).filter((r) => !r.deleted));
            open.result.close();
          };
        };
      }),
  );

/** Records still waiting for the model. */
const pending = async (page: Page): Promise<number> => (await rows(page)).filter((r) => r.refine === 'pending').length;

const UNSURE = ['репетитор по английскому 2000 за урок', 'на день рождения подарок 1500 сестре', 'за ремонт телефона 3500 мастеру'];

async function type(page: Page, phrase: string): Promise<number> {
  await tab(page, 'Новое');
  const again = page.locator('[data-action="again"]');
  if (await again.isVisible()) await again.click();
  await page.locator('#new-text').fill(phrase);
  const t0 = Date.now();
  await page.locator('[data-action="parse"]').click();
  await expect(page.getByTestId('saved')).toBeVisible();
  return Date.now() - t0;
}

test('off by default: Settings says so, saving works, no model file is requested', async ({ page }) => {
  const modelRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/model/')) modelRequests.push(r.url());
  });
  await page.goto('./');
  await type(page, 'репетитор по английскому 2000 за урок');
  await tab(page, 'Настройки');
  const panel = page.getByTestId('model');
  await expect(panel.getByRole('heading')).toHaveText('Умный разбор');
  await expect(panel.getByTestId('model-state')).toHaveText('Выключен. Всё и так записывается по правилам.');
  await expect(panel.locator('[data-action="model-toggle"]')).toHaveText('Скачать и включить (357 МБ)');
  await page.waitForTimeout(1000);
  expect(modelRequests).toEqual([]);
});

test('a load that was killed last time: the model is turned off and the owner is told once', async ({ page }) => {
  await page.goto('./');
  // The input appears after the model setup ran: set the flags only then, or this page itself would «recover» them.
  await expect(page.locator('#new-text')).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem('pb_model_enabled', '1');
    localStorage.setItem('pb_model_loading', '1');
  });
  await page.reload();
  await expect(toast(page)).toContainText('Мозг отключён: телефон не потянул.');
  await tab(page, 'Настройки');
  await expect(page.getByTestId('model-state')).toHaveText('Мозг отключён: телефон не потянул.');
  await expect(page.locator('[data-action="model-toggle"]')).toHaveText('Попробовать снова');
  await page.reload();
  await expect(toast(page)).toHaveCount(0); // told once, not on every start
});

test('the real model: loads from our site, saving stays instant, an unsure note is refined in the background', async ({ page }, info) => {
  // 357 MB and the CPU at full load: run on its own (MODEL_E2E=1), so it does not slow the other tests down.
  test.skip(!process.env.MODEL_E2E || info.project.name !== 'chromium', 'MODEL_E2E=1, Chromium only');
  test.setTimeout(600_000);
  const requested: string[] = [];
  const modelGets: string[] = [];
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) requested.push(r.url());
    if (r.url().includes('/model/') && r.method() === 'GET') modelGets.push(r.url());
  });
  await page.goto('./');
  const site = new URL(page.url()).origin;
  const note = (name: string, value: number): void => {
    info.annotations.push({ type: name, description: String(Math.round(value)) });
    console.log(`${name}: ${Math.round(value)}`);
  };

  // Unsure notes saved while the model is off stay ideas, marked for later.
  for (const p of UNSURE.slice(0, 2)) await type(page, p);
  expect(await pending(page)).toBe(2);

  await tab(page, 'Настройки');
  const t0 = Date.now();
  await page.locator('[data-action="model-toggle"]').click();
  await expect(page.getByTestId('model-state')).toContainText('Скачиваю');
  await expect(page.getByTestId('model-state')).toHaveText('Включён: уточняю непонятные фразы в фоне.', { timeout: 540_000 });
  note('download + load + 2 notes, ms', Date.now() - t0);

  // Every note was seen by the model. Whatever it said, the result is one of the allowed outcomes: still an idea
  // (the model said idea or something the app does not take from it), or a money record WITH the amount from the text.
  expect(await pending(page)).toBe(0);
  const check = async (): Promise<void> => {
    for (const r of await rows(page)) {
      if (!UNSURE.includes(r.raw_text)) continue;
      console.log(`model result: «${r.raw_text}» -> ${r.kind}`);
      expect(['idea', 'expense', 'income']).toContain(r.kind);
      if (r.kind !== 'idea') expect(r.fields.amount_minor).toBeGreaterThan(0);
    }
  };
  await check();

  // While the model works on a note, a new phrase is still saved at once.
  await type(page, UNSURE[2]);
  const busySave = await type(page, 'купил хлеб за 100');
  note('save while the model is busy, ms', busySave);
  expect(busySave).toBeLessThan(1000);
  await expect.poll(() => pending(page), { timeout: 120_000, intervals: [250] }).toBe(0);
  await check();

  // From the cache: reload (the model is not in memory any more), one unsure note, time until it is processed.
  const gotBefore = modelGets.length;
  await page.reload();
  const t1 = Date.now();
  await type(page, 'мастеру за ремонт часов 2700');
  expect(await pending(page)).toBe(1);
  await expect.poll(() => pending(page), { timeout: 120_000, intervals: [250] }).toBe(0);
  note('reload, load from cache + 1 note, ms', Date.now() - t1);
  // Downloaded once: after a reload the model comes from the cache, not a byte again (live Pages sends it gzip-compressed,
  // which used to make wllama throw the cached copy away on every start, see src/model/cache-fix.ts).
  expect(modelGets.slice(gotBefore)).toEqual([]);
  // Offline (the phone in the metro): the page comes from the service worker, the model from its own cache.
  await page.context().setOffline(true);
  await page.reload();
  await type(page, 'за химчистку пальто 1800 заплатить');
  expect(await pending(page)).toBe(1);
  await expect.poll(() => pending(page), { timeout: 120_000, intervals: [250] }).toBe(0);
  await tab(page, 'Настройки');
  await expect(page.getByTestId('model-state')).toHaveText('Включён: уточняю непонятные фразы в фоне.');
  await page.context().setOffline(false);
  expect(requested.filter((u) => new URL(u).origin !== site)).toEqual([]);
});
