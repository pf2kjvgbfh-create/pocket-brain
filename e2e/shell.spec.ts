import { expect, test } from '@playwright/test';

const TABS = ['Новое', 'Дела', 'Деньги', 'Мысли', 'Настройки'];

test('shell shows 5 tabs and has no horizontal scroll', async ({ page }, info) => {
  await page.goto('./');
  for (const name of TABS) await expect(page.getByRole('tab', { name })).toBeVisible();
  const width = page.viewportSize()!.width;
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `test-results/shots/shell-${info.project.name}.png` });
});

test('works offline after first load', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The first load is not controlled yet; a reload puts the page under the service worker.
  await page.reload();
  const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
  expect(controlled, 'service worker controls the page').toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Новое' })).toBeVisible();
  await context.setOffline(false);
});

test('iPhone test page runs steps 1-4 and shows the table', async ({ page }, info) => {
  test.skip(info.project.name.endsWith('1280'), 'phone width only');
  await page.goto('test/?cap=1024');
  await page.getByRole('button', { name: 'Сбросить' }).click();
  for (const step of ['1', '2', '3', '4']) {
    await page.locator(`button[data-step="${step}"]`).click();
    await expect(page.locator('#results tbody tr').nth(Number(step) - 1)).toHaveAttribute('data-state', /^(ok|fail)$/, {
      timeout: 60_000,
    });
  }
  await page.screenshot({ path: `test-results/shots/test-page-${info.project.name}.png`, fullPage: true });
});
