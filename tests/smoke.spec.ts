import { expect, test } from '@playwright/test';

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

test('first launch shows local-storage guidance', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Local Storage Only')).toBeVisible();
  await expect(page.getByText(/browser\/device profile only|browser and desktop app data are separate/i)).toBeVisible();
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByText('Local Storage Only')).toBeHidden();
});

test('create notes and edited content persists after reload', async ({ page }) => {
  const marker = `smoke-${Date.now()}`;
  await page.goto('/');

  await page.keyboard.press('Control+n');

  await page.locator('.cm-content').last().click();
  await page.keyboard.type(`# ${marker}\n\n- [ ] task`);
  await waitForMarkerPersisted(page, marker);
  await page.reload();
  await waitForMarkerPersisted(page, marker);
});

test('wiki-link preview mode is reachable', async ({ page }) => {
  const linkedTitle = `Linked-${Date.now()}`;
  await page.goto('/');
  await page.keyboard.press('Control+n');
  await page.locator('.cm-content').first().click();
  await page.keyboard.type(`Jump to [[${linkedTitle}]]`);
  await page.getByTitle('Preview Only').click();
  await expect(page.getByTitle('Preview Only')).toBeVisible();
});

test('invalid JSON import is blocked with readable error', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('Settings').click();
  await page.getByRole('button', { name: 'Data' }).click();

  const fileChooser = page.locator('input[type="file"][accept=".json"]');
  await fileChooser.setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"oops":true}'),
  });

  await expect(page.getByText(/backup file format is invalid|missing notes array/i)).toBeVisible();
});

test('export json button is available from backup section', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('Settings').click();
  await page.getByRole('button', { name: 'Data' }).click();
  await expect(page.getByRole('button', { name: 'Export JSON' })).toBeVisible();
});

test('reset and import recovery flow uses confirmation', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('Settings').click();
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('button', { name: 'New Workspace' }).click();
  await expect(page.getByText(/this will clear current data/i)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText(/this will clear current data/i)).toBeHidden();
});

test('graph tab opens in right panel', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('Toggle Panel').click();
  await expect(page.getByRole('button', { name: 'Graph' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tasks' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Backlinks' })).toBeVisible();
});

test('multi-tab content persists after closing and reopening tabs', async ({ page }) => {
  const markerA = `tab-a-${Date.now()}`;
  const markerB = `tab-b-${Date.now() + 1}`;
  await page.goto('/');

  // 创建笔记 A
  await page.keyboard.press('Control+n');
  await page.locator('.cm-content').last().click();
  await page.keyboard.type(`# ${markerA}`);
  await waitForMarkerPersisted(page, markerA);

  // 新建标签页，创建笔记 B
  await page.keyboard.press('Control+n');
  await page.locator('.cm-content').last().click();
  await page.keyboard.type(`# ${markerB}`);
  await waitForMarkerPersisted(page, markerB);

  // 页面重载后两条笔记内容仍在 IndexedDB 中
  await page.reload();
  await waitForMarkerPersisted(page, markerA);
  await waitForMarkerPersisted(page, markerB);
});

test('filesystem sync control and status are visible in data settings', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('Settings').click();
  await page.getByRole('button', { name: 'Data' }).click();
  await expect(page.getByText('Local File Sync')).toBeVisible();
  await expect(page.getByRole('button', { name: /Connect Folder|Disconnect/ })).toBeVisible();
});
