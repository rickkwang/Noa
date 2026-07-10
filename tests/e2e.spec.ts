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

async function saveHistorySnapshotForNote(
  page: import('@playwright/test').Page,
  noteTitle: string,
  content: string,
) {
  await page.evaluate(async ({ title, snapshotContent }) => {
    type StoredNote = { id: string; title: string };

    const openDatabase = (name: string) => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const notesDb = await openDatabase('redaction-diary-notes-db');
    const note = await new Promise<StoredNote | null>((resolve, reject) => {
      const transaction = notesDb.transaction('notes', 'readonly');
      const request = transaction.objectStore('notes').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(null);
          return;
        }
        const value = cursor.value as Partial<StoredNote>;
        if (
          String(cursor.key).startsWith('note:') &&
          value.title === title &&
          typeof value.id === 'string'
        ) {
          resolve({ id: value.id, title });
          return;
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
    notesDb.close();
    if (!note) throw new Error(`Note "${title}" was not found.`);

    const savedAt = new Date().toISOString();
    const historyDb = await openDatabase('redaction-diary-history-db');
    await new Promise<void>((resolve, reject) => {
      const transaction = historyDb.transaction('history', 'readwrite');
      transaction.objectStore('history').put(
        { noteId: note.id, title: note.title, content: snapshotContent, savedAt },
        `history:${note.id}:${savedAt}`,
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    historyDb.close();
  }, { title: noteTitle, snapshotContent: content });
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

test('app chrome prevents accidental text selection while content remains selectable', async ({ page }) => {
  await page.goto('/');

  const userSelect = async (locator: import('@playwright/test').Locator) =>
    locator.evaluate((element) => getComputedStyle(element).userSelect);

  await expect(page.locator('.noa-app-shell')).toBeVisible();
  expect(await userSelect(page.locator('.noa-app-shell'))).toBe('none');
  expect(await userSelect(page.getByTitle('Double-click to rename'))).toBe('none');
  expect(await userSelect(page.getByPlaceholder('Search notes, tags...'))).toBe('text');
  const editorContent = page.locator('.cm-content').last();
  expect(await userSelect(editorContent)).toBe('text');
  await editorContent.evaluate((element) => element.setAttribute('contenteditable', 'false'));
  expect(await userSelect(editorContent)).toBe('text');
  expect(await userSelect(page.locator('.noa-selectable').first())).toBe('text');

  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Editor' }).click();
  expect(await userSelect(page.getByPlaceholder('# {{date}}\n\n## Notes\n\n'))).toBe('text');
  await page.getByRole('tab', { name: 'Appearance' }).click();
  expect(await userSelect(page.getByRole('heading', { name: 'Theme' }))).toBe('none');
});

test('version history content remains selectable', async ({ page }) => {
  const marker = `history-selection-${Date.now()}`;
  await page.goto('/');

  await page.getByTitle('Version History').click();
  await expect(page.getByText('No history yet.', { exact: false })).toBeVisible();
  await page.getByTitle('Version History').click();

  await saveHistorySnapshotForNote(page, 'Welcome to Noa', marker);

  await page.getByTitle('Version History').click();
  const historyText = page.getByText(marker, { exact: true });
  await historyText.first().click();
  await expect(historyText).toHaveCount(2);
  expect(await historyText.last().evaluate((element) => getComputedStyle(element).userSelect)).toBe('text');
});

test('graph controls keep visible keyboard focus and hover feedback', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('app-settings', JSON.stringify({ appearance: { theme: 'light' } }));
    localStorage.setItem('app-right-panel-open', 'true');
    localStorage.setItem('app-right-tab', 'graph');
    localStorage.setItem('redaction-storage-notice-seen', '1');
    localStorage.setItem('app-graph-guide-seen', '1');
  });
  await page.goto('/');

  const input = page.getByPlaceholder('filter...');
  await input.focus();
  await expect(page.getByRole('group', { name: 'Graph filter controls' })).toHaveCSS(
    'border-top-color',
    'rgb(204, 125, 94)',
  );

  const zoomIn = page.getByTitle('Zoom in');
  await zoomIn.hover();
  await expect(zoomIn).toHaveCSS('color', 'rgb(204, 125, 94)');
});

test('graph canvas backing size remains stable during horizontal window resize', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.addInitScript(() => {
    localStorage.setItem('app-right-panel-open', 'true');
    localStorage.setItem('app-right-tab', 'graph');
    localStorage.setItem('redaction-storage-notice-seen', '1');
    localStorage.setItem('app-graph-guide-seen', '1');
  });

  await page.goto('/');
  await page.waitForSelector('canvas');

  const samples: Array<{ panelWidth: number; canvasWidth: number }> = [];
  for (const width of [1100, 1060, 1020, 980, 940, 900, 880]) {
    await page.setViewportSize({ width, height: 760 });
    await page.waitForTimeout(35);
    samples.push(await page.evaluate(() => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
      const panel = document.querySelector('[aria-label="Graph"]')?.closest('.w-full.h-full');
      return {
        panelWidth: Math.round(panel?.getBoundingClientRect().width ?? 0),
        canvasWidth: canvas?.width ?? 0,
      };
    }));
  }

  expect([...new Set(samples.map((sample) => sample.canvasWidth))]).toHaveLength(1);
  expect(Math.min(...samples.map((sample) => sample.canvasWidth))).toBeGreaterThanOrEqual(
    Math.max(...samples.map((sample) => sample.panelWidth)),
  );
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
