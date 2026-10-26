// Stage 7 part B: the owner's walk through the app on a phone — dictate (`#t=`), read the toast, «Последняя запись»,
// «Дела», «Деньги», «Настройки». Screenshots (CSS pixels, 375 px) go to test-results/shots/ux-<name>-<project>.png.
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { captureShortcutClicks, shortcutClicks, waitPastUndo } from './helpers';

const REMINDER = 'напомни завтра в 19:00 позвонить маме';
const TOKEN_PAGE =
  'https://github.com/settings/personal-access-tokens/new?name=pocket-brain&description=Backup%20for%20pocket-brain-data&target_name=pf2kjvgbfh-create&expires_in=366&contents=write';
/** Every kind of space (the app's money uses no-break spaces) turned into a plain one. */
const norm = (s: string | null): string => (s ?? '').replace(/[\s  ]+/g, ' ').trim();

const toast = (page: Page): Locator => page.getByTestId('toast');
const saved = (page: Page): Locator => page.getByTestId('saved');
const tab = (page: Page, name: string): Promise<void> => page.getByRole('tab', { name }).click();

async function addTyped(page: Page, phrase: string): Promise<void> {
  await tab(page, 'Новое');
  await page.locator('#new-text').fill(phrase);
  await page.locator('[data-action="parse"]').click();
  await expect(page.locator('#new-text')).toHaveValue('');
  await expect(saved(page)).toBeVisible();
}

const shot = (page: Page, info: TestInfo, name: string, fullPage = false): Promise<Buffer> =>
  page.screenshot({ path: `test-results/shots/ux-${name}-${info.project.name}.png`, scale: 'css', fullPage });

/** MSK calendar date «DD.MM» `days` from now (MSK = UTC+3). */
function mskDdMm(days: number): string {
  const t = new Date(Date.now() + 3 * 3_600_000 + days * 86_400_000);
  return `${String(t.getUTCDate()).padStart(2, '0')}.${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** «YYYY-MM-DDTHH:mm» of an MSK day `days` from now at `hhmm` (the value a date picker gives). */
function mskInput(days: number, hhmm: string): string {
  const t = new Date(Date.now() + 3 * 3_600_000 + days * 86_400_000);
  return `${t.toISOString().slice(0, 10)}T${hhmm}`;
}

/** Every visible button / link-button inside `scope` is at least 44 px high (a finger, not a mouse). */
async function bigEnoughTargets(scope: Locator): Promise<void> {
  const small = await scope.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('button, a.btn, a[href], input[type="checkbox"], summary')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const target = el instanceof HTMLInputElement ? (el.closest('label') ?? el) : el;
        const r = target.getBoundingClientRect();
        return { text: (el.textContent ?? el.getAttribute('aria-label') ?? '').trim(), h: Math.round(r.height), w: Math.round(r.width) };
      })
      .filter((t) => t.h < 44 || t.w < 44),
  );
  expect(small).toEqual([]);
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(page.viewportSize()!.width);
}

/** The toast must not lie over a button the owner may want to tap right now. */
async function toastCoversNothing(page: Page, buttons: Locator): Promise<void> {
  const t = (await toast(page).boundingBox())!;
  for (const b of await buttons.all()) {
    if (!(await b.isVisible())) continue;
    const r = (await b.boundingBox())!;
    const overlap = r.x < t.x + t.width && r.x + r.width > t.x && r.y < t.y + t.height && r.y + r.height > t.y;
    expect(overlap, `toast covers «${norm(await b.textContent())}»`).toBe(false);
  }
}

test.beforeEach(async ({ page }) => {
  await captureShortcutClicks(page);
});

test('expense: the toast says what, how much and from where; «Последняя запись» stays; edit and delete from it', async ({ page }, info) => {
  await page.goto('./');
  await addTyped(page, 'купил продукты за 1250');
  await expect(toast(page)).toContainText(/^Записал: продукты — 1\s250\s₽, Наличные/);
  await expect(saved(page)).toContainText('Последняя запись');
  await expect(saved(page)).toContainText(/Записал: продукты — 1\s250\s₽, Наличные/);
  await expect(page.getByTestId('card')).toHaveCount(0); // NOT a confirmation card: nothing waits for a tap
  await toastCoversNothing(page, page.locator('#screen-new button, #screen-new a.btn'));
  await bigEnoughTargets(saved(page));
  await noHorizontalScroll(page);
  await shot(page, info, 'toast-expense');

  await expect(toast(page)).toHaveCount(0, { timeout: 8000 });
  await expect(saved(page)).toBeVisible(); // stays until the next phrase
  await shot(page, info, 'last-record');

  await saved(page).locator('[data-action="last-edit"]').click();
  const sheet = page.locator('.sheet');
  await sheet.locator('[data-field="amount"]').fill('1300');
  await sheet.locator('[data-action="save"]').click();
  await expect(sheet).toHaveCount(0);
  await expect(saved(page)).toContainText(/продукты — 1\s300\s₽/);

  await saved(page).locator('[data-action="last-delete"]').click();
  await expect(saved(page)).toHaveCount(0);
  await expect(toast(page)).toContainText('Удалено');
  await expect(page.locator('#new-text')).toHaveValue('купил продукты за 1250'); // the phrase is never lost
  await tab(page, 'Деньги');
  await expect(page.locator('#screen-money [data-section="operations"] .row')).toHaveCount(0);
});

test('reminder: the toast says when (MSK, the phone time small), a countdown with «Не надо» stops the automatic open', async ({ page }, info) => {
  await page.goto(`./#t=${REMINDER}`);
  await expect(toast(page)).toContainText(`Напомню: позвонить маме — ${mskDdMm(1)} 19:00 МСК`);
  if (info.project.name === 'iphone-ny') await expect(toast(page)).toContainText(/\(у тебя \d{2}\.\d{2} \d{2}:\d{2}\)|\(у тебя \d{2}:\d{2}\)/);
  const countdown = page.getByTestId('countdown');
  await expect(countdown).toBeVisible();
  await expect(countdown).toContainText(/Ставлю напоминание через [1-5]…/);
  await toastCoversNothing(page, page.locator('#screen-new button, #screen-new a.btn'));
  await expect(saved(page).locator('[data-action="shortcut-help"]')).toBeHidden(); // the help waits for the try
  await bigEnoughTargets(saved(page));
  await noHorizontalScroll(page);
  await shot(page, info, 'toast-reminder-countdown');

  await countdown.locator('[data-action="auto-stop"]').click();
  await expect(countdown).toBeHidden();
  await expect(saved(page).locator('[data-action="shortcut-help"]')).toBeVisible();
  await expect(toast(page)).toBeVisible(); // the taller card (hint back) while the toast is still up
  await toastCoversNothing(page, page.locator('#screen-new button, #screen-new a.btn'));
  await waitPastUndo(page);
  expect(await shortcutClicks(page)).toEqual([]);
  // The button still works by hand.
  await saved(page).locator('[data-action="remind"]').click();
  expect(await shortcutClicks(page)).toEqual([expect.objectContaining({ auto: false })]);
});

test('a tap on «Поставить напоминание» during the countdown opens it once (no second automatic open)', async ({ page }) => {
  await page.goto(`./#t=${REMINDER}`);
  await expect(page.getByTestId('countdown')).toBeVisible();
  await saved(page).locator('[data-action="remind"]').click();
  await expect(page.getByTestId('countdown')).toBeHidden();
  await waitPastUndo(page);
  const clicks = await shortcutClicks(page);
  expect(clicks).toHaveLength(1);
  expect(clicks[0].auto).toBe(false);
});

test('«Не открылось? … как сделать» opens the steps for the Shortcut inside the app', async ({ page }, info) => {
  await page.goto(`./#t=${REMINDER}`);
  await page.getByTestId('countdown').locator('[data-action="auto-stop"]').click();
  await expect(saved(page)).toContainText('Не открылось? Нужна Команда «Мозг-напомнить» — как сделать');
  await saved(page).locator('[data-action="shortcut-help"]').click();
  const help = page.getByTestId('shortcut-help');
  await expect(help).toBeVisible();
  // One tap: the signed Shortcut file (stage 8); the hand-made steps stay folded below as a fallback.
  const install = help.locator('[data-action="install-remind"]');
  await expect(install).toBeVisible();
  expect(decodeURIComponent((await install.getAttribute('href')) ?? '')).toBe('shortcuts/Мозг-напомнить.shortcut');
  await expect(help.locator('ol.steps')).toBeHidden();
  await help.locator('details summary').click();
  await expect(help.locator('ol.steps li')).toHaveCount(7);
  await expect(help).toContainText('«Мозг-напомнить»');
  await noHorizontalScroll(page);
  await shot(page, info, 'shortcut-help', true);
  await help.locator('[data-action="help-close"]').click();
  await expect(help).toHaveCount(0);
  expect(await shortcutClicks(page)).toEqual([]);
});

test('two amounts: «Последняя запись» lists both, «Изменить» per row, one «Удалить все (2)»', async ({ page }) => {
  await page.goto('./');
  await addTyped(page, 'кофе 300 и круассан 250');
  await expect(toast(page)).toContainText(/Записал 2 записи: кофе — 300\s₽; круассан — 250\s₽ \(Наличные\)/);
  const items = saved(page).locator('.last-list li');
  await expect(items).toHaveCount(2);
  await toastCoversNothing(page, page.locator('#screen-new button, #screen-new a.btn'));
  await items.nth(1).locator('[data-action="last-edit"]').click();
  await expect(page.locator('.sheet [data-field="title"]')).toHaveValue('круассан');
  await page.locator('.sheet [data-action="cancel"]').click();
  await expect(saved(page).locator('[data-action="last-delete"]')).toHaveText('Удалить все (2)');
  await saved(page).locator('[data-action="last-delete"]').click();
  await expect(saved(page)).toHaveCount(0);
  await tab(page, 'Деньги');
  await expect(page.locator('#screen-money [data-section="operations"] .row')).toHaveCount(0);
});

test('«Дела»: upcoming first, past under «Прошедшие», done into «Сделано (N)»; the date field round-trips in MSK', async ({ page, browserName }, info) => {
  await page.goto('./');
  await addTyped(page, REMINDER);
  await page.getByTestId('countdown').locator('[data-action="auto-stop"]').click();
  await addTyped(page, 'напомни послезавтра в 10:00 купить хлеб');
  await addTyped(page, 'напомни завтра в 9:00 полить цветы');
  await addTyped(page, 'подписка на облако 149 рублей 1-го числа');
  await tab(page, 'Дела');
  const soon = page.locator('#screen-todo [data-block="soon"] .row[data-kind="reminder"]');
  await expect(soon).toHaveCount(3);
  expect((await soon.allTextContents()).map(norm).map((t) => t.split(' ')[0])).toEqual(['полить', 'позвонить', 'купить']);
  await expect(page.locator('#screen-todo .row[data-kind="subscription"]')).toContainText(/платёж \d{2}\.\d{2}/);

  // A15: move «купить хлеб» to yesterday through the date field (the native picker is checked on the phone).
  await soon.filter({ hasText: 'купить хлеб' }).click();
  const due = page.locator('.sheet [data-field="due"]');
  await expect(due).toHaveAttribute('type', 'datetime-local');
  if (browserName === 'chromium') expect(await due.evaluate((el) => (el as HTMLInputElement).type)).toBe('datetime-local');
  const yesterday = mskInput(-1, '08:30');
  await due.fill(yesterday);
  await page.locator('.sheet [data-action="save"]').click();
  await expect(page.locator('.sheet')).toHaveCount(0);
  const past = page.locator('#screen-todo [data-block="past"]');
  await expect(past).toContainText('Прошедшие');
  await expect(past.locator('.row')).toContainText(`${mskDdMm(-1)} 08:30 МСК`);
  await past.locator('.row').click();
  await expect(page.locator('.sheet [data-field="due"]')).toHaveValue(yesterday); // stored UTC, shown back in MSK
  await page.locator('.sheet [data-action="cancel"]').click();

  // «сделано»
  const mom = page.locator('#screen-todo li', { has: page.locator('.row', { hasText: 'позвонить маме' }) });
  await mom.locator('[data-action="done"]').check();
  const done = page.locator('#screen-todo [data-block="done"]');
  await expect(done.locator('summary')).toHaveText('Сделано (1)');
  await expect(done.locator('.row')).toBeHidden(); // collapsed
  await expect(soon).toHaveCount(1);
  await page.reload();
  await tab(page, 'Дела');
  await expect(done.locator('summary')).toHaveText('Сделано (1)');
  await done.locator('summary').click();
  await expect(done.locator('.row')).toContainText('позвонить маме');
  await expect(done.locator('[data-action="done"]')).toBeChecked();
  await bigEnoughTargets(page.locator('#screen-todo'));
  await noHorizontalScroll(page);
  await shot(page, info, 'todo-done', true);
});

test('«Деньги»: operations right after the wallets, «Показать ещё», a tap opens the editor; debts per person', async ({ page }, info) => {
  await page.goto('./');
  await addTyped(page, 'одолжил Пете 3000 наличными');
  await addTyped(page, 'я должен Ивану 5000');
  await addTyped(page, 'вернул ивану 2000');
  await expect(toast(page)).toContainText(/Вернул долг: Иван — 2\s000\s₽, с «Наличные»/);
  await addTyped(page, 'Петя вернул мне 1000');
  await expect(toast(page)).toContainText(/Мне вернули: Петя — 1\s000\s₽, на «Наличные»/);
  for (let i = 1; i <= 13; i += 1) await addTyped(page, `купил хлеб за ${i * 10}`);
  await tab(page, 'Деньги');
  const order = await page.locator('#screen-money [data-section]').evaluateAll((els) => els.map((e) => e.getAttribute('data-section')));
  expect(order.slice(0, 2)).toEqual(['wallets', 'operations']);
  const ops = page.locator('#screen-money [data-section="operations"] .row');
  await expect(ops).toHaveCount(15);
  const more = page.locator('[data-action="ops-more"]');
  await expect(more).toHaveText('Показать ещё (1)');
  const debts = page.locator('#screen-money [data-section="debts"]');
  await expect.poll(async () => norm(await debts.locator('.person').filter({ hasText: 'Иван' }).locator('[data-net]').textContent())).toBe('я должен / храню 3 000,00 ₽');
  await expect.poll(async () => norm(await debts.locator('.person').filter({ hasText: 'Петя' }).locator('[data-net]').textContent())).toBe('должен мне 2 000,00 ₽');
  await noHorizontalScroll(page);
  await shot(page, info, 'money', true);
  await more.click();
  await expect(ops).toHaveCount(16);
  await expect(more).toHaveCount(0);
  await ops.first().click();
  await expect(page.locator('.sheet').getByTestId('card')).toBeVisible();
  await page.locator('.sheet [data-action="cancel"]').click();
});

test('the Architect live phrases: a transfer to a new bank wallet, salary, a spent subscription, «в половине пятого»', async ({ page }) => {
  await page.goto('./');
  await addTyped(page, 'перевёл 10к на сбер');
  await expect(toast(page)).toContainText(/Перевод: 10\s000\s₽, Наличные → Сбер/);
  await addTyped(page, 'получил зарплату 120000');
  await expect(toast(page)).toContainText(/Доход: зарплата — 120\s000\s₽/);
  await addTyped(page, 'потратил 20 долларов на подписку');
  await expect(toast(page)).toContainText('Записал: подписка — 20 $');
  await expect(toast(page)).not.toContainText('в месяц');
  await addTyped(page, 'напомни в половине пятого забрать посылку');
  await expect(toast(page)).toContainText(/Напомню: забрать посылку — \d\d\.\d\d 16:30 МСК/);
  await tab(page, 'Деньги');
  await expect(page.locator('#screen-money [data-section="wallets"]')).toContainText('Сбер');
});

test('a subscription: the card with its hint and the toast leave «Записать» free', async ({ page }) => {
  await page.goto('./#t=подписка на облако 149 рублей 1-го числа');
  await expect(toast(page)).toContainText('Подписка: облако');
  await expect(saved(page).locator('[data-action="shortcut-help"]')).toBeVisible();
  await toastCoversNothing(page, page.locator('#screen-new button, #screen-new a.btn'));
});

test('«Настройки» without a copy: a red line, plain headings, numbered steps and the pre-filled GitHub link', async ({ page }, info) => {
  await page.goto('./');
  await tab(page, 'Настройки');
  const screen = page.locator('#screen-settings');
  await expect(page.getByTestId('no-backup')).toHaveText('Копии нет — записи только на этом телефоне');
  const headings = (await screen.locator('h2').allTextContents()).map(norm);
  expect(headings).toEqual(expect.arrayContaining(['Резервная копия в интернете', 'Ключ доступа', 'Умный помощник (необязательно)']));
  await expect(page.getByTestId('token-state')).toHaveText('Ключа нет');
  const steps = page.getByTestId('key-steps');
  await expect(steps.locator('li')).toHaveCount(5);
  await expect(steps).toContainText('«Repository access» → «Only select repositories» → «pocket-brain-data»');
  const link = page.locator('[data-action="token-page"]');
  await expect(link).toHaveAttribute('href', TOKEN_PAGE);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await bigEnoughTargets(screen);
  await noHorizontalScroll(page);
  await shot(page, info, 'settings-nobackup', true);
});

// Review 2026-10-26, item 5: the «Поставить напоминание» button inside the edit sheet must stop the countdown too.
test('the button in the edit sheet during the countdown opens the Shortcut once (no second automatic open)', async ({ page }) => {
  await page.goto(`./#t=${REMINDER}`);
  await expect(page.getByTestId('countdown')).toBeVisible();
  await tab(page, 'Дела');
  await page.locator('#screen-todo .row', { hasText: 'позвонить маме' }).click();
  await page.locator('.sheet [data-action="remind"]').click();
  await waitPastUndo(page);
  const clicks = await shortcutClicks(page);
  expect(clicks).toHaveLength(1);
  expect(clicks[0].auto).toBe(false);
});

// Review 2026-10-26, item 9: «Сделано (N)» stays open while it was open.
test('«Сделано (N)» stays open after a refresh', async ({ page }) => {
  await page.goto('./');
  await addTyped(page, REMINDER);
  await page.getByTestId('countdown').locator('[data-action="auto-stop"]').click();
  await addTyped(page, 'напомни завтра в 9:00 полить цветы');
  await tab(page, 'Дела');
  for (const what of ['позвонить маме', 'полить цветы']) {
    await page.locator('#screen-todo li', { has: page.locator('.row', { hasText: what }) }).locator('[data-action="done"]').check();
  }
  const done = page.locator('#screen-todo [data-block="done"]');
  await expect(done.locator('summary')).toHaveText('Сделано (2)');
  await done.locator('summary').click();
  await expect(done.locator('.row').first()).toBeVisible();
  await done.locator('li', { has: page.locator('.row', { hasText: 'полить цветы' }) }).locator('[data-action="done"]').uncheck();
  await expect(done.locator('summary')).toHaveText('Сделано (1)');
  await expect(done.locator('.row', { hasText: 'позвонить маме' })).toBeVisible(); // still open
});
