import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { captureShortcutClicks, reloadWithLink, shortcutClicks, waitPastUndo } from './helpers';

const REMINDER = 'напомни завтра в 19:00 позвонить маме';
const EXPENSE = 'купил воду за пятьсот рублей золотая карта';
const HELD = 'Иван отдал мне на хранение 3000, положил под 6,5%';
const HELD2 = 'Ольга дала мне на хранение пятьдесят тысяч под шесть с половиной процентов';
const UNCLEAR = 'что-то непонятное про вторник';

/** Money text with every kind of space turned into a plain one. */
const norm = (s: string | null): string => (s ?? '').replace(/[\s  ]+/g, ' ').trim();
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

const toast = (page: Page): Locator => page.getByTestId('toast');
const saved = (page: Page): Locator => page.getByTestId('saved');

// A reminder opens «Напоминания» by itself after the undo window: the click is recorded, never really followed.
test.beforeEach(async ({ page }) => {
  await captureShortcutClicks(page);
});

/** Typed route: «Новое» -> text -> «Записать» -> saved at once (no card, no «Сохранить»). */
async function addTyped(page: Page, phrase: string): Promise<void> {
  await tab(page, 'Новое');
  await page.locator('#new-text').fill(phrase);
  await page.locator('[data-action="parse"]').click();
  // Saved = the box is empty again and «Последняя запись» shows (it stays on the screen until the next phrase).
  await expect(page.locator('#new-text')).toHaveValue('');
  await expect(saved(page)).toBeVisible();
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

test('link -> saved at once with a toast, no tap; hash removed; a reload with the link gives no second record, a new open does', async ({ page }, info) => {
  await openLink(page, REMINDER);
  await expect(toast(page)).toContainText('Напомню: позвонить маме — ');
  await expect(toast(page)).toContainText(tomorrowDdMm());
  await expect(toast(page).locator('[data-action="undo"]')).toHaveText('Отменить');
  await expect(toast(page).locator('[data-action="edit"]')).toHaveText('Изменить');
  await expect(saved(page)).toBeVisible();
  await expect(page.getByTestId('card')).toHaveCount(0); // NO CONFIRMATION CARDS
  await expect.poll(() => page.url()).not.toContain('#t=');
  await noHorizontalScroll(page);
  // The toast fits the phone and sits above the tab bar, never over it.
  const box = (await toast(page).boundingBox())!;
  const bar = (await page.locator('.tabbar').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
  await shot(page, info, 'toast');

  await tab(page, 'Дела');
  const rows = page.locator('#screen-todo .row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('позвонить маме');
  await expect(rows.first()).toContainText(tomorrowDdMm());
  await shot(page, info, 'todo');

  await page.reload();
  await tab(page, 'Дела');
  await expect(rows).toHaveCount(1);

  // The SAME opening coming back (a reload while the link is still in the address): nothing new is written,
  // the toast says so and offers only «Изменить» (DECISIONS stage 7, item 11).
  await reloadWithLink(page, REMINDER);
  await expect(toast(page)).toContainText('Уже записано, второй раз не сохраняю. Напомню: позвонить маме');
  await expect(toast(page).locator('[data-action="edit"]')).toBeVisible();
  await expect(toast(page).locator('[data-action="undo"]')).toHaveCount(0);
  await expect.poll(() => page.url()).not.toContain('#t=');
  await tab(page, 'Дела');
  await expect(rows).toHaveCount(1);
  await page.reload();
  await tab(page, 'Дела');
  await expect(rows).toHaveCount(1);

  // A NEW opening of the same link is a new dictation: a second record.
  await openLink(page, REMINDER);
  await expect(toast(page)).toContainText('Напомню: позвонить маме');
  await tab(page, 'Дела');
  await expect(rows).toHaveCount(2);
});

test('«Отменить»: the record is gone, the text is back in the box, nothing opens by itself', async ({ page }) => {
  await openLink(page, 'купил воду за 500');
  await expect(toast(page)).toContainText(/^Записал: .+ — 500\s₽, Наличные/);
  await tab(page, 'Деньги');
  await expect(page.locator('#screen-money [data-section="operations"] .row')).toHaveCount(1);
  await tab(page, 'Новое');
  await toast(page).locator('[data-action="undo"]').click();
  await expect(page.locator('#new-text')).toHaveValue('купил воду за 500');
  await expect(toast(page)).toContainText('Отменено');
  await tab(page, 'Деньги');
  await expect(page.locator('#screen-money [data-section="operations"] .row')).toHaveCount(0);
  await expect.poll(() => text(page.locator('[data-wallet-id="cash"] .balance'))).toBe(rub(0));
  await page.reload();
  await tab(page, 'Деньги');
  await expect(page.locator('#screen-money [data-section="operations"] .row')).toHaveCount(0);
});

test('two taps (or a tap and Enter) on «Записать» write the phrase once', async ({ page }) => {
  await page.goto('./');
  await tab(page, 'Новое');
  await page.locator('#new-text').fill('купил хлеб за 100');
  // Both events in one go, before the first save can finish.
  await page.evaluate(() => {
    const b = document.querySelector<HTMLButtonElement>('[data-action="parse"]')!;
    b.click();
    document.querySelector('#new-text')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    b.click();
  });
  await expect(saved(page)).toBeVisible();
  await tab(page, 'Деньги');
  await expect(page.locator('#screen-money [data-section="operations"] .row')).toHaveCount(1);
});

test('«Отменить» also forgets the wallet the phrase named: the next phrase goes to the previous one', async ({ page }) => {
  await openLink(page, EXPENSE);
  await expect(toast(page)).toContainText('Золот');
  await toast(page).locator('[data-action="undo"]').click();
  await expect(toast(page)).toContainText('Отменено');
  await openLink(page, 'купил хлеб за 100');
  await expect(toast(page)).toContainText(/^Записал: .+ — 100\s₽, Наличные/);
});

test('a reminder deleted before the undo window ends does not open by itself', async ({ page }) => {
  await openLink(page, REMINDER);
  await expect(toast(page)).toContainText('Напомню: позвонить маме');
  await tab(page, 'Дела');
  await page.locator('#screen-todo .row').first().click();
  await page.locator('.sheet [data-action="delete"]').click();
  await page.locator('.sheet [data-action="delete-yes"]').click();
  await expect(page.locator('#screen-todo .row')).toHaveCount(0);
  await waitPastUndo(page);
  expect((await shortcutClicks(page)).filter((c) => c.auto)).toHaveLength(0);
});

test('«Изменить» opens the edit sheet of the saved record', async ({ page }) => {
  await openLink(page, EXPENSE);
  await toast(page).locator('[data-action="edit"]').click();
  await expect(toast(page)).toHaveCount(0);
  const sheet = page.locator('.sheet');
  await expect(sheet.getByTestId('card')).toBeVisible();
  await expect(sheet.locator('[data-field="kind"]')).toHaveValue('expense');
  await expect(sheet.locator('[data-field="wallet"]')).toHaveValue('gold');
  await sheet.locator('[data-field="amount"]').fill('777');
  await sheet.locator('[data-action="save"]').click();
  await expect(sheet).toHaveCount(0);
  await expect(saved(page)).toContainText(/777\s₽/);
  await tab(page, 'Деньги');
  await expect.poll(() => text(page.locator('[data-wallet-id="gold"] .balance'))).toBe(rub(-77700));
});

test('duplicate guard: a reload with the link still in the address gives one record; a fresh open of the same link saves again', async ({ page }) => {
  const ops = page.locator('#screen-money [data-section="operations"] .row');
  await openLink(page, EXPENSE);
  await expect(toast(page)).toContainText('Записал');
  await reloadWithLink(page, EXPENSE);
  await expect(toast(page)).toContainText('Уже записано');
  await tab(page, 'Деньги');
  await expect(ops).toHaveCount(1);
  // A fresh navigation (a new page load, not a reload) with the same link: a new dictation.
  await page.goto('about:blank');
  await openLink(page, EXPENSE);
  await expect(toast(page)).toContainText('Записал');
  await tab(page, 'Деньги');
  await expect(ops).toHaveCount(2);
  // The Shortcut opening the link again in the open tab (hash change only): also new.
  await openLink(page, EXPENSE);
  await expect(toast(page)).toContainText('Записал');
  await tab(page, 'Деньги');
  await expect(ops).toHaveCount(3);
});

test('a draft left by a killed page is saved after a reload, without opening «Напоминания»', async ({ page }) => {
  await page.goto('./'); // creates the database
  await expect(page.locator('#new-text')).toBeVisible();
  // Write the draft from the test page (same site, no app running), or the app page itself could pick it up first.
  await page.goto('./test/');
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('pocket-brain');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('drafts', 'readwrite');
          tx.objectStore('drafts').put({ id: 'leftover-1', text: 'напомни завтра в 19:00 позвонить маме', created_utc: new Date().toISOString() });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.goto('./');
  await expect(toast(page)).toContainText('Напомню: позвонить маме');
  await tab(page, 'Дела');
  await expect(page.locator('#screen-todo .row')).toHaveCount(1);
  await waitPastUndo(page);
  expect(await shortcutClicks(page)).toEqual([]);
  await page.reload();
  await tab(page, 'Дела');
  await expect(page.locator('#screen-todo .row')).toHaveCount(1); // the draft is gone, no second record
});

test('expense lowers the wallet balance by the amount', async ({ page }, info) => {
  await openLink(page, EXPENSE);
  await expect(toast(page)).toContainText(/^Записал: .+ — 500\s₽, Золотая карта/);
  await tab(page, 'Деньги');
  const gold = page.locator('[data-wallet-id="gold"] .balance');
  await expect.poll(() => text(gold)).toBe(rub(-50000));
  await expect.poll(() => text(page.locator('[data-wallet-id="cash"] .balance'))).toBe(rub(0));
  await noHorizontalScroll(page);
  await shot(page, info, 'money');
});

test('no wallet in the phrase: the last used wallet; the first ever default is cash', async ({ page }) => {
  await openLink(page, 'купил хлеб за 100');
  await expect(toast(page)).toContainText(/^Записал: .+ — 100\s₽, Наличные/);
  await addTyped(page, 'купил воду за 500 золотая карта');
  await expect(toast(page)).toContainText('Золотая карта');
  await addTyped(page, 'купил сок за 200');
  await expect(toast(page)).toContainText(/^Записал: .+ — 200\s₽, Золотая карта/);
  await page.reload();
  await addTyped(page, 'купил чай за 50'); // the last wallet survives a reload
  await expect(toast(page)).toContainText('Золотая карта');
  await tab(page, 'Деньги');
  await expect.poll(() => text(page.locator('[data-wallet-id="gold"] .balance'))).toBe(rub(-75000));
  await expect.poll(() => text(page.locator('[data-wallet-id="cash"] .balance'))).toBe(rub(-10000));
});

test('corrections memory: an edited wallet is applied to the next similar phrase (not the last wallet)', async ({ page }) => {
  await page.goto('./');
  // «кофе 300 вкусный» stays a thought (an amount AFTER a word is not read as a price); the edit makes it a purchase.
  await addTyped(page, 'кофе 300 вкусный');
  await expect(toast(page)).toContainText('Не понял — записал в мысли');
  await toast(page).locator('[data-action="edit"]').click();
  const sheet = page.locator('.sheet');
  await sheet.locator('[data-field="kind"]').selectOption('expense');
  await sheet.locator('[data-field="amount"]').fill('300');
  await sheet.locator('[data-field="wallet"]').selectOption('gold');
  await sheet.locator('[data-action="save"]').click();
  await expect(sheet).toHaveCount(0);
  // Another wallet becomes the last one; the learned wallet must still win for «кофе».
  await addTyped(page, 'купил воду за 500 серебряная карта');
  await addTyped(page, 'кофе 250 вкусный');
  await expect(toast(page)).toContainText(/^Записал: .+ — 250\s₽, Золотая карта/);
  await tab(page, 'Деньги');
  await expect.poll(() => text(page.locator('[data-wallet-id="gold"] .balance'))).toBe(rub(-55000));
  await expect.poll(() => text(page.locator('[data-wallet-id="silver"] .balance'))).toBe(rub(-50000));
  await page.reload(); // the memory is stored, not kept in the page
  await addTyped(page, 'кофе 100 вкусный');
  await expect(toast(page)).toContainText(/^Записал: .+ — 100\s₽, Золотая карта/);
});

test('«Долги и чужие деньги»: kept money is «я должен / храню», it grows with each held phrase', async ({ page }) => {
  await page.goto('./');
  await tab(page, 'Деньги');
  const total = page.locator('[data-total="i-owe"]');
  await expect.poll(() => text(total)).toBe(rub(0));
  await openLink(page, HELD);
  await expect(toast(page)).toContainText('Чужие деньги: Иван — 3');
  await tab(page, 'Деньги');
  await expect.poll(() => text(total)).toBe(rub(300000));
  await addTyped(page, HELD2);
  await tab(page, 'Деньги');
  await expect.poll(() => text(total)).toBe(rub(300000 + 5000000));
  const rows = page.locator('#screen-money [data-section="debts"] .row');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('#screen-money [data-section="debts"] .person').filter({ hasText: 'Иван' }).locator('.row')).toContainText('6,5%');
  await expect.poll(() => text(page.locator('[data-total="owed-to-me"]'))).toBe(rub(0));
});

test('debts: one net per person, two totals; money that moved changes the wallet, a mere fact does not', async ({ page }) => {
  await page.goto('./');
  await addTyped(page, 'одолжил Пете 3000 наличными'); // cash −3000, Петя owes me 3000
  await addTyped(page, 'Петя вернул мне 1000'); // last wallet (cash) +1000, Петя owes 2000
  await addTyped(page, 'Маша должна мне 1500'); // no wallet
  await addTyped(page, 'я должен Оле 500'); // no wallet
  await tab(page, 'Деньги');
  const debts = page.locator('#screen-money [data-section="debts"]');
  await expect(debts.locator('.person')).toHaveCount(3);
  await expect.poll(() => text(debts.locator('.person').filter({ hasText: 'Петя' }).locator('[data-net]'))).toBe(`должен мне ${rub(200000)}`);
  await expect.poll(() => text(debts.locator('.person').filter({ hasText: 'Оля' }).locator('[data-net]'))).toBe(`я должен / храню ${rub(50000)}`);
  await expect.poll(() => text(page.locator('[data-total="owed-to-me"]'))).toBe(rub(200000 + 150000));
  await expect.poll(() => text(page.locator('[data-total="i-owe"]'))).toBe(rub(50000));
  await expect.poll(() => text(page.locator('[data-wallet-id="cash"] .balance'))).toBe(rub(-300000 + 100000));
  await noHorizontalScroll(page);
});

test('a phrase with two amounts saves two records; «Отменить» removes both', async ({ page }) => {
  await page.goto('./');
  await addTyped(page, 'кофе 300 и круассан 250');
  await expect(toast(page)).toContainText('Записал 2 записи');
  await expect(toast(page).locator('[data-action="edit"]')).toHaveCount(0);
  await tab(page, 'Деньги');
  const ops = page.locator('#screen-money [data-section="operations"] .row');
  await expect(ops).toHaveCount(2);
  await expect.poll(() => text(page.locator('[data-wallet-id="cash"] .balance'))).toBe(rub(-55000));
  await toast(page).locator('[data-action="undo"]').click();
  await expect(toast(page)).toContainText('Отменено');
  await tab(page, 'Деньги');
  await expect(ops).toHaveCount(0);
  await expect.poll(() => text(page.locator('[data-wallet-id="cash"] .balance'))).toBe(rub(0));
  await page.reload();
  await tab(page, 'Деньги');
  await expect(ops).toHaveCount(0);
});

test('a deposit takes its amount out of its wallet; dollars stay out of every ruble total', async ({ page }) => {
  await page.goto('./');
  await addTyped(page, 'пришла зарплата 85 000 на тинькофф');
  await addTyped(page, 'положил 50000 на вклад с тинькофф');
  await addTyped(page, 'потратил 100 долларов на сувениры наличными');
  await tab(page, 'Деньги');
  await expect.poll(() => text(page.locator('[data-wallet-id="tinkoff"] .balance'))).toBe(rub(8_500_000 - 5_000_000));
  await expect.poll(() => text(page.locator('[data-total="deposits"]'))).toBe(rub(5_000_000));
  await expect.poll(() => text(page.locator('[data-wallet-id="cash"] .balance'))).toBe(rub(0));
  await expect.poll(() => text(page.locator('[data-total="wallets"]'))).toBe(`Всего ${rub(3_500_000)}`);
  const usd = page.locator('#screen-money [data-section="operations"] .row').filter({ hasText: '$' });
  await expect(usd).toContainText('в рублях не считается');
});

test('wallets: add, rename, hide; a hidden wallet leaves the edit select but stays in the totals', async ({ page }) => {
  await page.goto('./');
  await addTyped(page, 'пришла зарплата 85 000 на тинькофф');
  await tab(page, 'Деньги');

  // Add a wallet with a start balance.
  await page.locator('[data-action="wallet-add"]').click();
  await page.locator('[data-field="wallet-name"]').fill('Копилка сына');
  await page.locator('[data-field="wallet-start"]').fill('1500,50');
  await page.locator('[data-action="wallet-save"]').click();
  const wallets = page.locator('#screen-money [data-section="wallets"] .wallet-card');
  await expect(wallets).toHaveCount(5);
  const piggy = wallets.filter({ hasText: 'Копилка сына' });
  await expect.poll(() => text(piggy.locator('.balance'))).toBe(rub(150050));

  // A duplicate name is refused with a friendly message.
  await page.locator('[data-wallet-id="gold"]').click();
  await page.locator('[data-field="wallet-name"]').fill('наличные');
  await page.locator('[data-action="wallet-save"]').click();
  await expect(page.locator('.error').filter({ hasText: 'уже есть' })).toBeVisible();
  // Rename a default wallet.
  await page.locator('[data-field="wallet-name"]').fill('Моя карта');
  await page.locator('[data-action="wallet-save"]').click();
  await expect(page.locator('[data-wallet-id="gold"] .wallet-name')).toHaveText('Моя карта');

  // Hide Тинькофф: it moves to the hidden block and out of the visible grid.
  await page.locator('[data-wallet-id="tinkoff"]').click();
  await page.locator('[data-action="wallet-toggle-hidden"]').click();
  await expect(wallets).toHaveCount(4);
  await expect(page.locator('[data-section="wallets"] [data-wallet-id="tinkoff"]')).toHaveCount(0);
  const hiddenCard = page.locator('[data-section="hidden"] [data-wallet-id="tinkoff"]');
  await expect.poll(() => text(hiddenCard.locator('.balance'))).toBe(rub(8500000));
  // The records of the hidden wallet still count in the total.
  await expect.poll(() => text(page.locator('[data-total="wallets"]'))).toBe(`Всего ${rub(8500000 + 150050)}`);

  // The edit sheet offers visible wallets only; the renamed default wallet still answers to «золотая».
  await addTyped(page, EXPENSE);
  await expect(toast(page)).toContainText('Моя карта');
  await toast(page).locator('[data-action="edit"]').click();
  const select = page.locator('.sheet [data-field="wallet"]');
  await expect(select).toHaveValue('gold');
  const options = (await select.locator('option').allTextContents()).map(norm);
  expect(options).toContain('Моя карта');
  expect(options).toContain('Копилка сына');
  expect(options).not.toContain('Тинькофф');
  await page.locator('.sheet [data-action="cancel"]').click();

  // Un-hide: back in the grid.
  await tab(page, 'Деньги');
  await page.locator('[data-wallet-id="tinkoff"]').click();
  await page.locator('[data-action="wallet-toggle-hidden"]').click();
  await expect(wallets).toHaveCount(5);
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
  const expected: Record<string, number> = { cash: 0, gold: 0, silver: 0, tinkoff: 0 };
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
  await expect(toast(page)).toContainText(`Не понял — записал в мысли: ${UNCLEAR}`);
  await expect(saved(page)).toBeVisible();
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

test('typed text: Enter saves it, Shift+Enter does not', async ({ page }) => {
  await page.goto('./');
  const area = page.locator('#new-text');
  await expect(area).toHaveAttribute('enterkeyhint', 'done');
  await area.fill('идея: сделать скворечник');
  await area.press('Shift+Enter');
  await expect(saved(page)).toHaveCount(0);
  await area.press('Backspace');
  await area.press('Enter');
  await expect(saved(page)).toBeVisible();
  await expect(toast(page)).toContainText('Мысль: сделать скворечник');
  await tab(page, 'Мысли');
  await expect(page.locator('#screen-ideas .row')).toHaveCount(1);
  await expect(page.locator('#screen-ideas .row').first()).toContainText('скворечник');
});

test('an empty box saves nothing; a record can be edited and deleted from the list', async ({ page }) => {
  await page.goto('./');
  await page.locator('[data-action="parse"]').click();
  await expect(saved(page)).toHaveCount(0);

  await addTyped(page, 'что-то');
  await toast(page).locator('[data-action="edit"]').click();
  await page.locator('.sheet [data-field="kind"]').selectOption('expense');
  await page.locator('.sheet [data-field="amount"]').fill('');
  await page.locator('.sheet [data-action="save"]').click();
  await expect(saved(page)).toContainText('Записал: что-то');

  await tab(page, 'Деньги');
  const row = page.locator('[data-section="operations"] .row');
  await expect(row).toHaveCount(1);
  await row.click();
  await page.locator('[data-field="amount"]').fill('199,90');
  await page.locator('[data-action="save"]').click();
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
