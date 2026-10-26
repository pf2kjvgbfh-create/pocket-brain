// Stage 8: the «Установка» page and the two signed Shortcut files on the site.
import { expect, test } from '@playwright/test';

const FILES = [
  ['install-brain', 'Мозг.shortcut'],
  ['install-remind', 'Мозг-напомнить.shortcut'],
] as const;

test('«Установка»: three big buttons, the files are signed Shortcuts', async ({ page, request }, info) => {
  await page.goto('./install/');
  await expect(page.getByRole('heading', { name: 'Установка' })).toBeVisible();
  for (const [id, file] of FILES) {
    const link = page.getByTestId(id);
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(decodeURIComponent(href ?? '')).toBe(`../shortcuts/${file}`);
    const res = await request.get(new URL(href ?? '', page.url()).href);
    expect(res.status()).toBe(200);
    const body = await res.body();
    expect(body.subarray(0, 4).toString('latin1')).toBe('AEA1'); // Apple signed archive
    expect(body.length).toBeGreaterThan(10_000);
  }
  const step3 = page.getByTestId('install-action-button');
  await expect(step3.locator('ol.steps li')).toHaveCount(4);
  await expect(step3.locator('ol.steps')).toBeHidden();
  await step3.locator('summary').click();
  await expect(step3.locator('ol.steps')).toBeVisible();
  await expect(step3).toContainText('«Мозг»');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/shots/install-${info.project.name}.png`, scale: 'css', fullPage: true });
});

test('Settings link to «Установка»', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('tab', { name: 'Настройки' }).click();
  const link = page.getByTestId('install-link');
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/install\/$/);
});
