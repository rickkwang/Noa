import { expect, test } from '@playwright/test';

test('app boots and core UI is reachable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Noa').first()).toBeVisible();
  await expect(page.getByPlaceholder('Search notes, tags...')).toBeVisible();
});

test('create and edit note content persists after reload', async ({ page }) => {
  const marker = `smoke-${Date.now()}`;

  await page.goto('/');
  await page.keyboard.press('Control+n');
  await page.locator('.cm-content').first().click();
  await page.keyboard.type(`# ${marker}\n\n- [ ] smoke task`);
  await page.waitForTimeout(2000);

  await page.reload();
  await page.getByPlaceholder('Search notes, tags...').fill(marker);
  await expect(page.locator(`text=${marker}`).first()).toBeVisible();
});

test('settings data actions are accessible', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('Settings').click();
  await expect(page.getByText('SETTINGS').first()).toBeVisible();
  await page.getByRole('button', { name: 'Data' }).click();
  await expect(page.getByRole('button', { name: 'Export JSON' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import JSON' })).toBeVisible();
});
