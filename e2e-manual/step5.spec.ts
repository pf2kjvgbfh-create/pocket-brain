import { expect, test } from '@playwright/test';

// Manual check (not in the default suite): step 5a downloads ~490 MB from Hugging Face.
test('test page step 5a loads Qwen2.5 via wllama-compat', async ({ page }, info) => {
  test.setTimeout(900_000);
  await page.goto('test/');
  await page.locator('button[data-step="5a"]').click();
  const row = page.locator('#results tbody tr').nth(4);
  await expect(row).toHaveAttribute('data-state', /^(ok|fail)$/, { timeout: 880_000 });
  console.log('ROW5a:', (await row.innerText()).replace(/\s+/g, ' '));
  await page.screenshot({ path: `test-results/shots/test-page-5a-${info.project.name}.png`, fullPage: true });
});
