import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

const REMINDER = 'напомни завтра в 19:00 позвонить маме';
const EXPENSE = 'купил воду за пятьсот рублей золотая карта';
const HELD = 'Иван отдал мне на хранение 3000, положил под 6,5%';
const HELD2 = 'Ольга дала мне на хранение пятьдесят тысяч под шесть с половиной процентов';
const UNCLEAR = 'что-то непонятное про вторник';

/** Money text with every kind of space turned into a plain one. */
const norm = (s: string | null): string => (s ?? '').replace(/[\s  ]+/g, ' ').trim();
const text = async (loc: Locator): Promise<string> => norm(await loc.textContent());

/** Kopecks -> «1 234,50 ₽» (the test's own formatter, independent of the app's). */
function rub(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${whole},${String(abs % 100).padStart(2, '0')} ₽`;
}

async function tab(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name }).click();
}

async function openLink(page: Page, phrase: string): Promise<void> {
  await page.goto(`./#t=${phrase}`);
}

const save = (page: Page): Locator => page.locator('[data-action="save"]');
const card = (page: Page): Locator => page.getByTestId('card');

/** Typed route: «Новое» -> text -> «Разобрать» -> card -> «Сохранить». */
async function addTyped(page: Page, phrase: string): Promise<void> {
  await tab(page, 'Новое');
  const again = page.locator('[data-action="again"]');
  if (await again.isVisible()) await again.click();
  await page.locator('#new-text').fill(phrase);
  await page.locator('[data-action="parse"]').click();
  await expect(card(page)).toBeVisible();
  await save(page).click();
  await expect(page.getByTestId('saved')).toBeVisible();
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const width = page.viewportSize()!.width;
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(width);
}

const shot = (page: Page, info: TestInfo, name: string): Promise<Buffer> =>
  page.screenshot({ path: `test-results/shots/${name}-${info.project.name}.png` });

function tomorrowDdMm(): RegExp {
  const t = new Date(Date.now() + 27 * 3_600_000); // MSK now = UTC + 3h; plus one day
  const dd = String(t.getUTCDate()).padStart(2, '0');
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  return new RegExp(`${dd}\\.${mm}.*19:00 МСК`);
}

test('link -> card -> save -> list; hash removed; reload and a second open give exactly one record', async ({ page }, info) => {
  await openLink(page, REMINDER);
  await expect(card(page)).toBeVisible();
  const sentence = page.getByTestId('sentence');
  await expect(sentence).toContainText('напоминание');
  await expect(sentence).toContainText('завтра 19:00 МСК');
  await expect.poll(() => page.url()).not.toContain('#t=');
  await noHorizontalScroll(page);
  await shot(page, info, 'card');

  await save(page).click();
  await expect(page.getByTestId('saved')).toBeVisible();
  await tab(page, 'Дела');
  const rows = page.locator('#screen-todo .row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('позвонить маме');
  await expect(rows.first()).toContainText(tomorrowDdMm());
  await shot(page, info, 'todo');

  await page.reload();
  await tab(page, 'Дела');
  await expect(rows).toHaveCount(1);

  // The same link again: the saved record is shown, nothing new is created.
  await openLink(page, REMINDER);
  await expect(page.locator('.notice')).toContainText('Уже сохранено');
  await expect.poll(() => page.url()).not.toContain('#t=');
  await tab(page, 'Дела');
  await expect(rows).toHaveCount(1);
  await page.reload();
  await tab(page, 'Дела');
  await expect(rows).toHaveCount(1);
});

test('opening the same link twice before saving reuses one draft and gives one record', async ({ page }) => {
  await openLink(page, EXPENSE);
  await expect(card(page)).toBeVisible();
  await openLink(page, EXPENSE);
  await expect(card(page)).toBeVisible();
  await save(page).click();
  await expect(page.getByTestId('saved')).toBeVisible();
  await tab(page, 'Деньги');
  await expect(page.locator('#screen-money [data-section="operations"] .row')).toHaveCount(1);
});

test('an unsaved card survives a reload as a pending draft', async ({ page }) => {
  await openLink(page, REMINDER);
  await expect(card(page)).toBeVisible();
  await page.reload();
  await expect(card(page)).toBeVisible();
  await save(page).click();
  await expect(page.getByTestId('saved')).toBeVisible();
  await tab(page, 'Дела');
  await expect(page.locator('#screen-todo .row')).toHaveCount(1);
});

test('expense lowers the wallet balance by the amount', async ({ page }, info) => {
  await openLink(page, EXPENSE);
  await expect(page.getByTestId('sentence')).toContainText('расход');
  await expect(page.getByTestId('sentence')).toContainText('Золотая карта');
  await save(page).click();
  await expect(page.getByTestId('saved')).toBeVisible();
  await tab(page, 'Деньги');
  const gold = page.locator('[data-wallet-id="gold"] .balance');
  await expect.poll(() => text(gold)).toBe(rub(-50000));
  await expect.poll(() => text(page.locator('[data-wallet-id="cash"] .balance'))).toBe(rub(0));
  await noHorizontalScroll(page);
  await shot(page, info, 'money');
});

test('«Чужие деньги» total grows with each held phrase', async ({ page }) => {
  await page.goto('./');
  await tab(page, 'Деньги');
  const total = page.locator('[data-total="held"]');
  await expect.poll(() => text(total)).toBe(rub(0));
  await openLink(page, HELD);
  await expect(page.getByTestId('sentence')).toContainText('чужие деньги');
  await save(page).click();
  await expect(page.getByTestId('saved')).toBeVisible();
  await tab(page, 'Деньги');
  await expect.poll(() => text(total)).toBe(rub(300000));
  await addTyped(page, HELD2);
  await tab(page, 'Деньги');
  await expect.poll(() => text(total)).toBe(rub(300000 + 5000000));
  const rows = page.locator('#screen-money [data-section="held"] .row');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'Иван' })).toContainText('6,5%');
});

test('wallets: add, rename, hide; a hidden wallet leaves the card select but stays in the totals', async ({ page }) => {
  await page.goto('./');
  await addTyped(page, 'пришла зарплата 85 000 на тинькофф');
  await tab(page, 'Деньги');

  // Add a wallet with a start balance.
  await page.locator('[data-action="wallet-add"]').click();
  await page.locator('[data-field="wallet-name"]').fill('Копилка сына');
  await page.locator('[data-field="wallet-start"]').fill('1500,50');
  await page.locator('[data-action="wallet-save"]').click();
  const wallets = page.locator('#screen-money [data-section="wallets"] .wallet-card');
  await expect(wallets).toHaveCount(6);
  const piggy = wallets.filter({ hasText: 'Копилка сына' });
  await expect.poll(() => text(piggy.locator('.balance'))).toBe(rub(150050));

  // A duplicate name is refused with a friendly message.
  await page.locator('[data-wallet-id="gold"]').click();
  await page.locator('[data-field="wallet-name"]').fill('наличные');
  await page.locator('[data-action="wallet-save"]').click();
  await expect(page.locator('.error')).toContainText('уже есть');
  // Rename a default wallet.
  await page.locator('[data-field="wallet-name"]').fill('Моя карта');
  await page.locator('[data-action="wallet-save"]').click();
  await expect(page.locator('[data-wallet-id="gold"] .wallet-name')).toHaveText('Моя карта');

  // Hide Тинькофф: it moves to the hidden block and out of the visible grid.
  await page.locator('[data-wallet-id="tinkoff"]').click();
  await page.locator('[data-action="wallet-toggle-hidden"]').click();
  await expect(wallets).toHaveCount(5);
  await expect(page.locator('[data-section="wallets"] [data-wallet-id="tinkoff"]')).toHaveCount(0);
  const hiddenCard = page.locator('[data-section="hidden"] [data-wallet-id="tinkoff"]');
  await expect.poll(() => text(hiddenCard.locator('.balance'))).toBe(rub(8500000));
  // The records of the hidden wallet still count in the total.
  await expect.poll(() => text(page.locator('[data-total="wallets"]'))).toBe(`Всего ${rub(8500000 + 150050)}`);

  // The card offers visible wallets only; the renamed default wallet still answers to «золотая».
  await tab(page, 'Новое');
  await page.locator('[data-action="again"]').click();
  await page.locator('#new-text').fill(EXPENSE);
  await page.locator('[data-action="parse"]').click();
  const select = page.locator('[data-field="wallet"]');
  await expect(select).toHaveValue('gold');
  const options = (await select.locator('option').allTextContents()).map(norm);
  expect(options).toContain('Моя карта');
  expect(options).toContain('Копилка сына');
  expect(options).not.toContain('Тинькофф');
  await page.locator('[data-action="cancel"]').click();

  // Un-hide: back in the grid.
  await tab(page, 'Деньги');
  await page.locator('[data-wallet-id="tinkoff"]').click();
  await page.locator('[data-action="wallet-toggle-hidden"]').click();
  await expect(wallets).toHaveCount(6);
});

test('totals match a hand-computed value after a sequence of records', async ({ page }) => {
  await page.goto('./');
  // [phrase, [walletId, delta in kopecks][]]
  const steps: [string, [string, number][]][] = [
    ['пришла зарплата 85 000 на тинькофф', [['tinkoff', 8_500_000]]],
    ['потратил 1 250 рублей на такси с тинькофф', [['tinkoff', -125_000]]],
    ['перекинул пять тысяч с золотой карты на наличные', [['gold', -500_000], ['cash', 500_000]]],
    ['заплатил за обед 450 наличными', [['cash', -45_000]]],
    ['кэшбэк 320 рублей на золотую карту', [['gold', 32_000]]],
  ];
  const expected: Record<string, number> = { cash: 0, deposit: 0, gold: 0, silver: 0, tinkoff: 0 };
  for (const [phrase, deltas] of steps) {
    await addTyped(page, phrase);
    for (const [id, d] of deltas) expected[id] += d;
  }
  await tab(page, 'Деньги');
  for (const [id, minor] of Object.entries(expected)) {
    await expect.poll(() => text(page.locator(`[data-wallet-id="${id}"] .balance`)), { message: id }).toBe(rub(minor));
  }
  const sum = Object.values(expected).reduce((a, b) => a + b, 0);
  expect(sum).toBe(8_362_000);
  await expect.poll(() => text(page.locator('[data-total="wallets"]'))).toBe(`Всего ${rub(sum)}`);
  await expect(page.locator('[data-section="operations"] .row')).toHaveCount(5);

  // Deleting one record (with the in-page confirm) takes it out of the totals.
  await page.locator('[data-section="operations"] .row').filter({ hasText: 'обед' }).click();
  await page.locator('[data-action="delete"]').click();
  await page.locator('[data-action="delete-yes"]').click();
  await expect(page.locator('[data-section="operations"] .row')).toHaveCount(4);
  await expect.poll(() => text(page.locator('[data-wallet-id="cash"] .balance'))).toBe(rub(expected.cash + 45_000));
  await page.reload();
  await tab(page, 'Деньги');
  await expect.poll(() => text(page.locator('[data-wallet-id="cash"] .balance'))).toBe(rub(expected.cash + 45_000));
});

test('an unclear phrase becomes a thought, the text is kept, and tags filter the list', async ({ page }) => {
  await openLink(page, UNCLEAR);
  await expect(page.locator('[data-field="kind"]')).toHaveValue('idea');
  await expect(page.getByTestId('sentence')).toContainText('мысль');
  await expect(save(page)).toBeEnabled();
  await save(page).click();
  await expect(page.getByTestId('saved')).toBeVisible();
  await addTyped(page, 'идея: купить удочку #рыбалка');

  await tab(page, 'Мысли');
  const rows = page.locator('#screen-ideas .row');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: UNCLEAR })).toHaveCount(1);
  await page.locator('.chip[data-tag="рыбалка"]').click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('удочку');
  await page.locator('.chip[data-tag=""]').click();
  await expect(rows).toHaveCount(2);
  await page.reload();
  await tab(page, 'Мысли');
  await expect(rows.filter({ hasText: UNCLEAR })).toHaveCount(1);
  await noHorizontalScroll(page);
});

test('save is never blocked: an empty card of any kind saves; editing and deleting a record work', async ({ page }) => {
  await page.goto('./');
  await page.locator('#new-text').fill('что-то');
  await page.locator('[data-action="parse"]').click();
  await page.locator('[data-field="kind"]').selectOption('expense');
  await page.locator('[data-field="amount"]').fill('');
  await save(page).click();
  await expect(page.getByTestId('saved')).toBeVisible();

  await tab(page, 'Деньги');
  const row = page.locator('[data-section="operations"] .row');
  await expect(row).toHaveCount(1);
  await row.click();
  await page.locator('[data-field="amount"]').fill('199,90');
  await save(page).click();
  await expect(row).toContainText('199,90');
  await row.click();
  await page.locator('[data-action="delete"]').click();
  await page.locator('[data-action="delete-no"]').click();
  await page.locator('[data-action="cancel"]').click();
  await expect(row).toHaveCount(1);
});

test('every tab fits the screen width and settings show only the version', async ({ page }) => {
  await page.goto('./');
  await addTyped(page, 'подписка на облако 149 рублей 1-го числа');
  await addTyped(page, 'открыла вклад полтора миллиона под 19% на 12 месяцев');
  for (const name of ['Новое', 'Дела', 'Деньги', 'Мысли', 'Настройки']) {
    await tab(page, name);
    await noHorizontalScroll(page);
  }
  await tab(page, 'Деньги');
  await expect.poll(() => text(page.locator('[data-total="subscriptions"]'))).toBe(`${rub(14900)} в месяц`);
  await expect.poll(() => text(page.locator('[data-total="deposits"]'))).toBe(rub(150_000_000));
  await tab(page, 'Дела');
  await expect(page.locator('#screen-todo .row')).toHaveCount(1);
  await tab(page, 'Настройки');
  await expect(page.getByTestId('version')).toContainText('Версия');
});
