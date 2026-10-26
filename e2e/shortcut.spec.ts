import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { captureShortcutClicks, reloadWithLink, shortcutClicks, waitPastUndo, type ShortcutClick } from './helpers';

// A saved reminder opens the Shortcut «Мозг-напомнить» BY ITSELF when the toast's undo window passes
// (<a data-action="remind-auto"> click); a subscription never does (only its button). The test never opens the scheme: captureShortcutClicks (a test-side click
// listener) cancels the default action and records each click. Production code has no hook.

const PREFIX =
  'shortcuts://run-shortcut?name=%D0%9C%D0%BE%D0%B7%D0%B3-%D0%BD%D0%B0%D0%BF%D0%BE%D0%BC%D0%BD%D0%B8%D1%82%D1%8C&input=text&text=';
const REMINDER = 'напомни завтра в 19:00 позвонить маме';
const OTHER = 'напомни послезавтра в 10:00 купить хлеб';
const SUBSCRIPTION = '17-го каждого месяца 300 рублей за облако';
const AUTO_TIMEOUT = 15_000;

interface Payload {
  title: string;
  due: string;
  due_local: string;
  due_msk: string;
  repeat: string;
}

const toast = (page: Page) => page.getByTestId('toast');

function decode(click: ShortcutClick): Payload {
  expect(click.href.startsWith(PREFIX)).toBe(true);
  return JSON.parse(decodeURIComponent(click.href.slice(PREFIX.length))) as Payload;
}

/** Tomorrow's MSK calendar date «YYYY-MM-DD» (MSK = UTC+3). */
function tomorrowMsk(): string {
  return new Date(Date.now() + 27 * 3_600_000).toISOString().slice(0, 10);
}

const shot = (page: Page, info: TestInfo, name: string): Promise<Buffer> =>
  page.screenshot({ path: `test-results/shots/${name}-${info.project.name}.png` });

/** Click the visible «Поставить напоминание» button (data-action="remind") and return that click. */
async function tapRemind(page: Page, scope = ''): Promise<ShortcutClick> {
  const link = page.locator(`${scope} [data-action="remind"]`.trim());
  await expect(link).toBeVisible();
  await expect(page.locator(`${scope} .remind .hint`.trim())).toHaveText(
    'Если iPhone спросит «Открыть?» — нажми «Открыть». Не открылось? Нужна Команда «Мозг-напомнить» — как сделать',
  );
  await expect(page.locator(`${scope} .remind [data-action="shortcut-help"]`.trim())).toBeVisible();
  const before = page.url();
  const count = (await shortcutClicks(page)).length;
  await link.click();
  const clicks = await shortcutClicks(page);
  expect(clicks.length).toBe(count + 1);
  expect(page.url()).toBe(before);
  const click = clicks[clicks.length - 1];
  expect(click.auto).toBe(false);
  return click;
}

test.beforeEach(async ({ page }) => {
  await captureShortcutClicks(page);
});

test('reminder: after the undo window the Shortcut opens by itself with the right payload (MSK time in the title)', async ({ page }, info) => {
  await page.goto(`./#t=${REMINDER}`);
  await expect(toast(page)).toContainText('Напомню: позвонить маме');
  expect(await shortcutClicks(page)).toEqual([]); // not before the toast ends
  await shot(page, info, 'reminder');

  await expect.poll(async () => (await shortcutClicks(page)).length, { timeout: AUTO_TIMEOUT }).toBe(1);
  const [click] = await shortcutClicks(page);
  expect(click.auto).toBe(true);
  const payload = decode(click);
  expect(payload.title).toBe('позвонить маме — 19:00 МСК');
  expect(payload.due).toBe(`${tomorrowMsk()}T19:00:00+03:00`);
  expect(payload.due_msk).toContain('19:00 МСК');
  expect(payload.due_local).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  expect(payload.repeat).toBe('none');
  expect(Object.keys(payload).sort()).toEqual(['due', 'due_local', 'due_msk', 'repeat', 'title']);
  await expect(toast(page)).toHaveCount(0);
  // After the try the countdown is gone and the «Не открылось? … как сделать» help is back.
  await expect(page.getByTestId('countdown')).toBeHidden();
  await expect(page.locator('[data-testid="saved"] [data-action="shortcut-help"]')).toBeVisible();
  // Only one automatic open, not repeated.
  await page.waitForTimeout(1500);
  expect((await shortcutClicks(page)).length).toBe(1);
});

test('«Отменить» inside the undo window: no record, no automatic open', async ({ page }) => {
  await page.goto(`./#t=${REMINDER}`);
  await toast(page).locator('[data-action="undo"]').click();
  await expect(toast(page)).toContainText('Отменено');
  await waitPastUndo(page);
  expect(await shortcutClicks(page)).toEqual([]);
  await page.getByRole('tab', { name: 'Дела' }).click();
  await expect(page.locator('#screen-todo .row')).toHaveCount(0);
});

test('«Изменить» cancels the automatic open; the button in the sheet still works', async ({ page }) => {
  await page.goto(`./#t=${REMINDER}`);
  await toast(page).locator('[data-action="edit"]').click();
  await waitPastUndo(page);
  expect(await shortcutClicks(page)).toEqual([]);
  const click = await tapRemind(page, '.sheet');
  expect(decode(click).title).toBe('позвонить маме — 19:00 МСК');
});

test('a newer phrase inside the window cancels the first automatic open', async ({ page }) => {
  await page.goto(`./#t=${REMINDER}`);
  await expect(toast(page)).toContainText('Напомню: позвонить маме');
  await page.goto(`./#t=${OTHER}`); // same page, new hash: a second phrase
  await expect.poll(async () => (await shortcutClicks(page)).length, { timeout: AUTO_TIMEOUT }).toBeGreaterThan(0);
  await waitPastUndo(page);
  const clicks = await shortcutClicks(page);
  expect(clicks.length).toBe(1);
  expect(decode(clicks[0]).title).toBe('купить хлеб — 10:00 МСК');
});

test('a reload with the link after the automatic open: «Уже записано», no new open, one record', async ({ page }) => {
  await page.goto(`./#t=${REMINDER}`);
  await expect.poll(async () => (await shortcutClicks(page)).length, { timeout: AUTO_TIMEOUT }).toBe(1);
  await reloadWithLink(page, REMINDER); // the click log starts empty again on the reloaded page
  await expect(toast(page)).toContainText('Уже записано');
  await waitPastUndo(page);
  expect((await shortcutClicks(page)).length).toBe(0);
  await page.getByRole('tab', { name: 'Дела' }).click();
  await expect(page.locator('#screen-todo .row')).toHaveCount(1);
});

test('after the page is left alone the reminder stays in «Дела» with the button', async ({ page }) => {
  await page.goto(`./#t=${REMINDER}`);
  await expect.poll(async () => (await shortcutClicks(page)).length, { timeout: AUTO_TIMEOUT }).toBe(1);
  await page.reload();
  await page.getByRole('tab', { name: 'Дела' }).click();
  await page.locator('#screen-todo .row').first().click();
  const click = await tapRemind(page, '.sheet');
  expect(decode(click).title).toBe('позвонить маме — 19:00 МСК');
});

test('subscription: never opens by itself; its button «о платеже» gives monthly, next occurrence with +03:00', async ({ page }) => {
  await page.goto(`./#t=${SUBSCRIPTION}`);
  await expect(toast(page)).toContainText('Подписка: ');
  await expect(page.getByTestId('countdown')).toBeHidden(); // no «Ставлю напоминание через …» for a subscription
  await waitPastUndo(page);
  expect(await shortcutClicks(page)).toEqual([]);
  await expect(page.locator('[data-testid="saved"] [data-action="remind"]')).toHaveText('Поставить напоминание о платеже');
  const payload = decode(await tapRemind(page, '[data-testid="saved"]'));
  expect(payload.repeat).toBe('monthly');
  expect(payload.due).toMatch(/^\d{4}-\d{2}-17T12:00:00\+03:00$/);
  expect(Date.parse(payload.due)).toBeGreaterThan(Date.now());
  expect(payload.title).toMatch(/ — 12:00 МСК$/);
});

test('an idea has no button and never opens anything', async ({ page }) => {
  await page.goto('./');
  await page.locator('#new-text').fill('идея: сделать скворечник');
  await page.locator('[data-action="parse"]').click();
  await expect(page.getByTestId('saved')).toBeVisible();
  await expect(page.locator('[data-action="remind"]')).toHaveCount(0);
  await waitPastUndo(page);
  expect(await shortcutClicks(page)).toEqual([]);
});
