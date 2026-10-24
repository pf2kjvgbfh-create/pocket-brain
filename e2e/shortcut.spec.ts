import { expect, test, type Page, type TestInfo } from '@playwright/test';

// «Поставить напоминание» is a plain <a href="shortcuts://…">. The test never opens the scheme: a click listener added by
// the TEST (addInitScript, not part of the app) cancels the default action and records the href. Production code has no hook.

const PREFIX =
  'shortcuts://run-shortcut?name=%D0%9C%D0%BE%D0%B7%D0%B3-%D0%BD%D0%B0%D0%BF%D0%BE%D0%BC%D0%BD%D0%B8%D1%82%D1%8C&input=text&text=';
const REMINDER = 'напомни завтра в 19:00 позвонить маме';
const SUBSCRIPTION = '17-го каждого месяца 300 рублей за облако';

interface Payload {
  title: string;
  due: string;
  due_local: string;
  due_msk: string;
  repeat: string;
}

declare global {
  interface Window {
    __lastNavigation?: string;
  }
}

async function captureNavigation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.addEventListener('click', (e) => {
      const a = (e.target as Element | null)?.closest('a[href^="shortcuts:"]');
      if (!a) return;
      e.preventDefault();
      window.__lastNavigation = a.getAttribute('href') ?? '';
    });
  });
}

async function saveFromLink(page: Page, phrase: string): Promise<void> {
  await page.goto(`./#t=${phrase}`);
  await expect(page.getByTestId('card')).toBeVisible();
  await page.locator('[data-action="save"]').click();
  await expect(page.getByTestId('saved')).toBeVisible();
}

/** Click the remind link and return the decoded payload. The page must not have navigated. */
async function tapRemind(page: Page, scope = ''): Promise<Payload> {
  const link = page.locator(`${scope} [data-action="remind"]`.trim());
  await expect(link).toBeVisible();
  await expect(page.locator(`${scope} .remind .hint`.trim())).toHaveText('Откроется Команда «Мозг-напомнить» — если iPhone спросит, нажми «Открыть»');
  const before = page.url();
  await link.click();
  const url = await page.evaluate(() => window.__lastNavigation);
  expect(url).toBeDefined();
  expect(url!.startsWith(PREFIX)).toBe(true);
  expect(page.url()).toBe(before);
  return JSON.parse(decodeURIComponent(url!.slice(PREFIX.length))) as Payload;
}

/** Tomorrow's MSK calendar date «YYYY-MM-DD» (MSK = UTC+3). */
function tomorrowMsk(): string {
  return new Date(Date.now() + 27 * 3_600_000).toISOString().slice(0, 10);
}

const shot = (page: Page, info: TestInfo, name: string): Promise<Buffer> =>
  page.screenshot({ path: `test-results/shots/${name}-${info.project.name}.png` });

test('reminder: the button opens the expected shortcuts:// URL with the right payload', async ({ page }, info) => {
  await captureNavigation(page);
  await saveFromLink(page, REMINDER);
  await shot(page, info, 'reminder');
  const payload = await tapRemind(page);
  expect(payload.title).toBe('позвонить маме');
  expect(payload.due).toBe(`${tomorrowMsk()}T19:00:00+03:00`);
  expect(payload.due_msk).toContain('19:00 МСК');
  expect(payload.due_local).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  expect(payload.repeat).toBe('none');
  expect(Object.keys(payload).sort()).toEqual(['due', 'due_local', 'due_msk', 'repeat', 'title']);
});

test('subscription: monthly, next occurrence with +03:00', async ({ page }) => {
  await captureNavigation(page);
  await saveFromLink(page, SUBSCRIPTION);
  const payload = await tapRemind(page);
  expect(payload.repeat).toBe('monthly');
  expect(payload.due).toMatch(/^\d{4}-\d{2}-17T12:00:00\+03:00$/);
  expect(Date.parse(payload.due)).toBeGreaterThan(Date.now());
  expect(payload.title.length).toBeGreaterThan(0);
});

test('edit sheet in «Дела» has the button; an idea has none', async ({ page }) => {
  await captureNavigation(page);
  await saveFromLink(page, REMINDER);
  await page.getByRole('tab', { name: 'Дела' }).click();
  await page.locator('#screen-todo .row').first().click();
  const payload = await tapRemind(page, '.sheet');
  expect(payload.title).toBe('позвонить маме');

  await page.reload();
  await page.getByRole('tab', { name: 'Новое' }).click();
  await page.locator('#new-text').fill('идея: сделать скворечник');
  await page.locator('[data-action="parse"]').click();
  await page.locator('[data-action="save"]').click();
  await expect(page.getByTestId('saved')).toBeVisible();
  await expect(page.locator('[data-action="remind"]')).toHaveCount(0);
});
