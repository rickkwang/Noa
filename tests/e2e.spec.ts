import { readFile } from 'node:fs/promises';
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
  await page.getByTitle('Search notes').click();
  await page.getByPlaceholder('Search notes, tags...').fill('"Welcome to Noa"');
  await expect(page.getByText(/Search Results \([1-9]\d*\)/)).toBeVisible();
});

test('search icon closes an open search field on a second click', async ({ page }) => {
  await page.goto('/');

  const searchButton = page.getByTitle('Search notes');
  const searchInput = page.getByPlaceholder('Search notes, tags...');
  await searchButton.click();
  await searchInput.fill('Welcome');
  await expect(page.getByText(/Search Results \([1-9]\d*\)/)).toBeVisible();

  await searchButton.click();
  await expect(searchInput).toBeHidden();
  await expect(page.getByText(/Search Results \([1-9]\d*\)/)).toHaveCount(0);
});

test('tab strip occupies the title-bar row instead of leaving a second header row', async ({ page }) => {
  await page.goto('/');

  const [tabBox, searchBox, sidebarActionBox, rightPanelTabBox] = await Promise.all([
    page.locator('[data-tab-id]').first().boundingBox(),
    page.getByTitle('Search notes').boundingBox(),
    page.getByTitle('New note').boundingBox(),
    page.getByRole('button', { name: 'Tasks' }).boundingBox(),
  ]);

  expect(tabBox).not.toBeNull();
  expect(searchBox).not.toBeNull();
  expect(sidebarActionBox).not.toBeNull();
  expect(rightPanelTabBox).not.toBeNull();
  expect(tabBox!.y).toBeLessThanOrEqual(searchBox!.y + 4);
  expect(sidebarActionBox!.y).toBeGreaterThanOrEqual(searchBox!.y + 24);
  // The panel tabs moved up into the title bar too, so they now share the row
  // with search rather than sitting a header row below it.
  expect(rightPanelTabBox!.y).toBeLessThanOrEqual(searchBox!.y + 4);
});

test('lifted title-bar tab controls opt out of the native drag region', async ({ page }) => {
  await page.goto('/');

  const appRegion = async (locator: import('@playwright/test').Locator) =>
    locator.evaluate((element) => getComputedStyle(element).getPropertyValue('-webkit-app-region'));

  await expect(page.locator('[data-tab-id]').first()).toBeVisible();
  expect(await appRegion(page.locator('[data-tab-id]').first())).toBe('no-drag');
  expect(await appRegion(page.getByRole('button', { name: 'New tab' }))).toBe('no-drag');
});

test('expanded desktop search does not cover the first tab when the sidebar is closed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Toggle sidebar' }).click();
  await page.getByRole('button', { name: 'Search notes' }).click();
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished'));

  const [inputBox, tabBox] = await Promise.all([
    page.getByRole('textbox', { name: 'Search notes' }).boundingBox(),
    page.locator('[data-tab-id]').first().boundingBox(),
  ]);
  expect(inputBox).not.toBeNull();
  expect(tabBox).not.toBeNull();
  expect(inputBox!.x + inputBox!.width).toBeLessThanOrEqual(tabBox!.x);
});

test('expanded mobile search keeps its clear button above the title-bar actions', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Search notes' }).click();
  const searchInput = page.getByRole('textbox', { name: 'Search notes' });
  await searchInput.fill('Welcome');
  await searchInput.locator('..').evaluate(async (container) => {
    await Promise.all(container.getAnimations().map((animation) => animation.finished));
  });

  const clearButton = page.getByRole('button', { name: 'Clear search' });
  const [inputBox, clearBox] = await Promise.all([
    searchInput.boundingBox(),
    clearButton.boundingBox(),
  ]);
  expect(inputBox).not.toBeNull();
  expect(clearBox).not.toBeNull();
  expect(inputBox!.width).toBeGreaterThanOrEqual(80);
  const topmostControl = await page.evaluate(({ x, y }) => {
    return document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null;
  }, {
    x: clearBox!.x + clearBox!.width / 2,
    y: clearBox!.y + clearBox!.height / 2,
  });
  expect(topmostControl).toBe('Clear search');
});

test('Cmd+F exits focus mode and focuses the mounted search input', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Search notes' })).toBeVisible();
  await page.keyboard.press('Meta+Shift+f');
  await expect(page.getByRole('button', { name: 'Search notes' })).toHaveCount(0);

  await page.keyboard.press('Meta+f');
  const searchInput = page.getByRole('textbox', { name: 'Search notes' });
  await expect(searchInput).toBeVisible();
  await expect(searchInput).toBeFocused();
});

test('cyclic view control exposes the current editor mode', async ({ page }) => {
  await page.goto('/');

  const modeButton = page.getByRole('button', { name: /Switch to (edit|split|preview) view/ });
  await expect(modeButton).toHaveAttribute('aria-description', 'Current view: split');
  await modeButton.click();
  await expect(modeButton).toHaveAttribute('aria-description', 'Current view: preview');
});

test('right panel toggle remains clickable after the panel is collapsed', async ({ page }) => {
  await page.goto('/');

  const toggle = page.getByRole('button', { name: 'Toggle right panel' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(300);

  const toggleBox = await toggle.boundingBox();
  expect(toggleBox).not.toBeNull();
  const topmostControl = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return element?.closest('button')?.getAttribute('aria-label') ?? null;
  }, {
    x: toggleBox!.x + toggleBox!.width / 2,
    y: toggleBox!.y + toggleBox!.height / 2,
  });
  expect(topmostControl).toBe('Toggle right panel');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

test('app chrome prevents accidental text selection while content remains selectable', async ({ page }) => {
  await page.goto('/');

  const userSelect = async (locator: import('@playwright/test').Locator) =>
    locator.evaluate((element) => getComputedStyle(element).userSelect);

  await expect(page.locator('.noa-app-shell')).toBeVisible();
  expect(await userSelect(page.locator('.noa-app-shell'))).toBe('none');
  expect(await userSelect(page.getByTitle('Double-click to rename'))).toBe('none');
  await page.getByTitle('Search notes').click();
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

  // Version History moved out of the toolbar into the editor overflow menu, so
  // it is a menuitem now and no longer carries a title attribute of its own.
  const toggleHistory = async () => {
    await page.getByTitle('More actions').click();
    await page.getByRole('menuitem', { name: 'Version History' }).click();
  };

  await toggleHistory();
  await expect(page.getByText('No history yet.', { exact: false })).toBeVisible();
  await toggleHistory();

  await saveHistorySnapshotForNote(page, 'Welcome to Noa', marker);

  await toggleHistory();
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

  // The filter cluster no longer has a frame to tint on focus — it reads as a
  // field from an accent wash instead. Focus is now carried by the global
  // input:focus-visible rule in index.css, so assert the affordance that
  // actually renders rather than the group border that used to.
  const input = page.getByPlaceholder('filter...');
  await input.focus();
  await expect(input).toHaveCSS('outline-style', 'solid');
  await expect(input).toHaveCSS('outline-width', '2px');
  await expect(input).toHaveCSS('outline-color', 'rgb(204, 125, 94)');

  const zoomIn = page.getByTitle('Zoom in');
  await zoomIn.hover();
  await expect(zoomIn).toHaveCSS('color', 'rgb(204, 125, 94)');
});

test('closed right panel defers its lazy content until first open', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('app-right-panel-open', 'false');
    localStorage.setItem('redaction-storage-notice-seen', '1');
  });
  await page.goto('/');

  await expect(page.locator('[data-noa-right-panel-content]')).toHaveCount(0);
  await page.getByTitle('Toggle Panel').click();
  await expect(page.locator('[data-noa-right-panel-content]')).toHaveCount(1);
  await page.getByTitle('Toggle Panel').click();
  await expect(page.locator('[data-noa-right-panel-content]')).toHaveCount(1);
});

test('restored-open right panel waits until the post-load animation frame', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('app-right-panel-open', 'true');
    localStorage.setItem('app-right-tab', 'tasks');
    localStorage.setItem('redaction-storage-notice-seen', '1');

    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const queuedFrames: FrameRequestCallback[] = [];
    let holdFrames = true;

    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      if (!holdFrames) return nativeRequestAnimationFrame(callback);
      queuedFrames.push(callback);
      return queuedFrames.length;
    };

    (window as Window & { __flushNoaAnimationFrames?: () => void }).__flushNoaAnimationFrames = () => {
      holdFrames = false;
      const timestamp = performance.now();
      queuedFrames.splice(0).forEach((callback) => callback(timestamp));
    };
  });

  await page.goto('/');
  await expect(page.getByTitle('Search notes')).toBeVisible();
  await expect(page.locator('[data-noa-right-panel-content]')).toHaveCount(0);

  await page.evaluate(() => {
    (window as Window & { __flushNoaAnimationFrames?: () => void }).__flushNoaAnimationFrames?.();
  });
  await expect(page.locator('[data-noa-right-panel-content]')).toHaveCount(1);
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

  await page.getByTitle('Settings').click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"]')).toBeHidden();

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

test('appearance settings persist after a full reload', async ({ page }) => {
  await page.goto('/');

  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  const selects = page.getByRole('combobox');
  await selects.nth(0).selectOption('dark');
  await selects.nth(1).selectOption('font-redaction');
  await expect(selects.nth(0)).toHaveValue('dark');
  await expect(selects.nth(1)).toHaveValue('font-redaction');

  await page.reload();
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await expect(page.getByRole('combobox').nth(0)).toHaveValue('dark');
  await expect(page.getByRole('combobox').nth(1)).toHaveValue('font-redaction');
});

test('a recovered settings read merges and persists a queued change', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('redaction-storage-notice-seen', '1');
    localStorage.setItem('app-settings', JSON.stringify({
      appearance: { theme: 'light' },
      templates: {
        userTemplates: [{
          id: 'keep-template',
          name: 'Keep',
          content: 'important',
          createdAt: '2026-01-01',
        }],
      },
      backup: { autoBackupEnabled: true },
    }));
    const realGetItem = Storage.prototype.getItem;
    (window as typeof window & { __allowSettingsRead?: boolean }).__allowSettingsRead = false;
    Storage.prototype.getItem = function getItem(key: string) {
      if (key === 'app-settings'
        && !(window as typeof window & { __allowSettingsRead?: boolean }).__allowSettingsRead) {
        throw new DOMException('temporary', 'SecurityError');
      }
      return realGetItem.call(this, key);
    };
  });
  await page.goto('/');

  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.getByRole('combobox').nth(0).selectOption('dark');
  await page.evaluate(() => {
    (window as typeof window & { __allowSettingsRead?: boolean }).__allowSettingsRead = true;
  });

  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('app-settings') ?? '{}');
    return saved.appearance?.theme;
  })).toBe('dark');
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('app-settings') ?? '{}'));
  expect(persisted.appearance.theme).toBe('dark');
  expect(persisted.templates.userTemplates).toEqual([{
    id: 'keep-template',
    name: 'Keep',
    content: 'important',
    createdAt: '2026-01-01',
  }]);
  expect(persisted.backup.autoBackupEnabled).toBe(true);
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
