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
  await page.getByRole('button', { name: 'Data' }).click();
}

test('new note flow creates and persists a note', async ({ page }) => {
  const marker = `e2e-note-${Date.now()}`;
  await page.goto('/');

  await page.keyboard.press('Control+n');
  await page.locator('.cm-content').last().click();
  await page.keyboard.type(`# ${marker}\n\nThis note verifies the create flow.`);

  await waitForMarkerPersisted(page, marker);
  await page.reload();
  await waitForMarkerPersisted(page, marker);
});

test('search returns a note by title and content', async ({ page }) => {
  const marker = `e2e-search-${Date.now()}`;
  await page.goto('/');

  await page.keyboard.press('Control+n');
  await page.locator('.cm-content').last().click();
  await page.keyboard.type(`# ${marker}\n\nSearch target body text.`);
  await waitForMarkerPersisted(page, marker);

  await page.getByPlaceholder('Search notes, tags...').fill(marker);
  await expect(page.getByText('Search Results (1)', { exact: true })).toBeVisible();
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
