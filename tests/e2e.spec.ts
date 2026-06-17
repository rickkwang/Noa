import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function waitForMarkerPersisted(page: import('@playwright/test').Page, marker: string) {
  await page.waitForFunction(
    async (target) => {
      const request = indexedDB.open('redaction-diary-notes-db');
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      if (!db) return false;

      const tx = db.transaction('notes', 'readonly');
      const store = tx.objectStore('notes');
      const entries = await new Promise<any[]>((resolve) => {
        const out: any[] = [];
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) {
            resolve(out);
            return;
          }
          out.push({ key: cursor.key, value: cursor.value });
          cursor.continue();
        };
        cursorReq.onerror = () => resolve([]);
      });

      db.close();
      return entries.some((entry) =>
        String(entry?.key).startsWith('note:') &&
        typeof entry?.value?.content === 'string' &&
        entry.value.content.includes(target)
      );
    },
    marker,
    { timeout: 10_000 },
  );
}

async function openDataSettings(page: import('@playwright/test').Page) {
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Data' }).click();
}

test('new note flow creates and persists a note', async ({ page }) => {
  const marker = `e2e-note-${Date.now()}`;
  await page.goto('/');

  await page.getByTitle('New note').click();
  await page.locator('.cm-content').last().click();
  await page.keyboard.type(`# ${marker}\n\nThis note verifies the create flow.`);

  await waitForMarkerPersisted(page, marker);
  await page.reload();
  await waitForMarkerPersisted(page, marker);
});

test('search returns a note by title and content', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to Noa' })).toBeVisible();
  await page.getByPlaceholder('Search notes, tags...').fill('"Welcome to Noa"');
  await expect(page.getByText(/Search Results \([1-9]\d*\)/)).toBeVisible();
});

test('export json downloads a valid backup file', async ({ page }) => {
  await page.goto('/');
  await openDataSettings(page);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadPromise;

  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const raw = await readFile(downloadPath as string, 'utf8');
  const parsed = JSON.parse(raw) as { notes?: unknown[]; folders?: unknown[] };
  expect(Array.isArray(parsed.notes)).toBe(true);
  expect(Array.isArray(parsed.folders)).toBe(true);
});

test('import json restores notes from a backup file', async ({ page }) => {
  const marker = `e2e-import-${Date.now()}`;
  await page.goto('/');
  await openDataSettings(page);

  const backup = {
    notes: [
      {
        id: `note-${Date.now()}`,
        title: marker,
        content: `# ${marker}\n\nImported note body.`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        folder: '',
        tags: [],
        links: [],
      },
    ],
    folders: [],
    workspaceName: 'Imported Workspace',
  };

  await page.locator('input[type="file"][accept=".json"]').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup), 'utf8'),
  });

  await expect(page.getByText(/This may replace existing data/i)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText(/Imported 1 notes/i)).toBeVisible();

  await page.reload();
  await waitForMarkerPersisted(page, marker);
  await expect(page.getByText(marker, { exact: false })).toBeVisible();
});

test('settings modal closes with escape and backdrop click', async ({ page }) => {
  await page.goto('/');

  const searchInput = page.getByPlaceholder('Search notes, tags...');
  await searchInput.fill('Welcome');
  await page.getByTitle('Settings').click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"]')).toBeHidden();
  await expect(searchInput).toHaveValue('Welcome');

  await page.getByTitle('Settings').click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(page.locator('[role="dialog"]')).toBeHidden();
});

test('settings tabs support keyboard navigation', async ({ page }) => {
  await page.goto('/');

  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Appearance' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Data' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Export JSON' })).toBeVisible();
});

test('settings remembers the last active tab when reopened', async ({ page }) => {
  await page.goto('/');

  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'About' }).click();
  await expect(page.getByRole('button', { name: 'Export Diagnostics' })).toBeVisible();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.locator('[role="dialog"]')).toBeHidden();

  await page.getByTitle('Settings').click();
  await expect(page.getByRole('button', { name: 'Export Diagnostics' })).toBeVisible();
});

test('settings keeps primary controls inside the dialog at narrower widths', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 700 });
  await page.goto('/');

  await page.getByTitle('Settings').click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();

  const dialogBox = await dialog.boundingBox();
  const themeSelectBox = await page.getByRole('combobox').first().boundingBox();

  expect(dialogBox).not.toBeNull();
  expect(themeSelectBox).not.toBeNull();
  if (!dialogBox || !themeSelectBox) {
    throw new Error('Settings dialog geometry could not be measured.');
  }

  expect(themeSelectBox.x + themeSelectBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width);
});
