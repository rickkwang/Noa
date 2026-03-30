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

async function installMockDirectoryPicker(
  page: import('@playwright/test').Page,
) {
  await page.addInitScript(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('redaction-diary-fs-db');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const syncMode = { failWrites: false };
    (window as typeof window & { __syncMode?: typeof syncMode }).__syncMode = syncMode;

    class MockFileHandle {
      kind = 'file' as const;
      name: string;
      private content = '';

      constructor(name: string) {
        this.name = name;
      }

      async getFile() {
        return {
          text: async () => this.content,
          lastModified: Date.now(),
        };
      }

      async createWritable() {
        await delay(40);
        if (syncMode.failWrites) {
          throw new DOMException('blocked', 'NotAllowedError');
        }
        const fileHandle = this;
        return {
          async write(value: string) {
            await delay(40);
            fileHandle.content = value;
          },
          async close() {
            await delay(20);
          },
        };
      }
    }

    class MockDirectoryHandle {
      kind = 'directory' as const;
      name: string;
      entriesMap = new Map<string, MockDirectoryHandle | MockFileHandle>();

      constructor(name: string) {
        this.name = name;
      }

      async getDirectoryHandle(childName: string, { create } = { create: false }) {
        await delay(30);
        const existing = this.entriesMap.get(childName);
        if (existing instanceof MockDirectoryHandle) return existing;
        if (existing) throw new DOMException('missing', 'TypeMismatchError');
        if (!create) throw new DOMException('missing', 'NotFoundError');
        const next = new MockDirectoryHandle(childName);
        this.entriesMap.set(childName, next);
        return next;
      }

      async getFileHandle(fileName: string, { create } = { create: false }) {
        await delay(30);
        const existing = this.entriesMap.get(fileName);
        if (existing instanceof MockFileHandle) return existing;
        if (existing) throw new DOMException('missing', 'TypeMismatchError');
        if (!create) throw new DOMException('missing', 'NotFoundError');
        const next = new MockFileHandle(fileName);
        this.entriesMap.set(fileName, next);
        return next;
      }

      async removeEntry(entryName: string) {
        await delay(20);
        this.entriesMap.delete(entryName);
      }

      async *entries() {
        await delay(20);
        for (const entry of this.entriesMap.entries()) {
          yield entry;
        }
      }

      async queryPermission() {
        return 'granted';
      }

      async requestPermission() {
        return 'granted';
      }
    }

    const picker: NonNullable<typeof window.showDirectoryPicker> = async () => {
      await delay(30);
      return new MockDirectoryHandle('mock-sync') as unknown as FileSystemDirectoryHandle;
    };
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: picker,
    });
  });
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
  await installMockDirectoryPicker(page);
  await page.goto('/');
  await page.getByTitle('Settings').click();
  await page.getByRole('button', { name: 'Data' }).click();
  await expect(page.getByText('Vault Folder', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Connect Folder|Disconnect/ })).toBeVisible();
});

test('filesystem sync status transitions from syncing to ready on retry', async ({ page }) => {
  await installMockDirectoryPicker(page);
  await page.goto('/');
  await page.getByTitle('Settings').click();
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('button', { name: 'Connect Folder' }).click();

  await expect(page.getByText(/Sync status: ready/i)).toBeVisible();
  await page.getByRole('button', { name: 'Retry Sync' }).click();
  await expect(page.getByText(/Sync status: syncing/i)).toBeVisible();
  await expect(page.getByText(/Sync status: ready/i)).toBeVisible();
});

test('filesystem sync status transitions from syncing to error on retry', async ({ page }) => {
  await installMockDirectoryPicker(page);
  await page.goto('/');
  await page.getByTitle('Settings').click();
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('button', { name: 'Connect Folder' }).click();

  await expect(page.getByText(/Sync status: ready/i)).toBeVisible();
  await page.evaluate(() => {
    const syncMode = (window as typeof window & { __syncMode?: { failWrites: boolean } }).__syncMode;
    if (syncMode) syncMode.failWrites = true;
  });
  await page.getByRole('button', { name: 'Retry Sync' }).click();
  await expect(page.getByText(/Sync status: syncing/i)).toBeVisible();
  await expect(page.getByText(/Sync status: error/i)).toBeVisible();
  await expect(page.getByText(/Sync error:/i)).toBeVisible();
});

test('attachment previews recycle object URLs when switching notes', async ({ page }) => {
  const statsScript = () => {
    const stats = { created: [] as string[], revoked: [] as string[] };
    const originalCreate = URL.createObjectURL.bind(URL);
    const originalRevoke = URL.revokeObjectURL.bind(URL);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: ((blob: Blob) => {
        const url = originalCreate(blob);
        stats.created.push(url);
        return url;
      }) as typeof URL.createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: ((url: string) => {
        stats.revoked.push(url);
        return originalRevoke(url);
      }) as typeof URL.revokeObjectURL,
    });
    (window as typeof window & { __urlStats?: typeof stats }).__urlStats = stats;
  };

  await page.addInitScript(statsScript);
  await page.goto('/');

  await page.keyboard.press('Control+n');
  const attachmentInput = page.locator('input[type="file"][accept="image/*"]');
  await attachmentInput.setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wf5K5sAAAAASUVORK5CYII=',
      'base64',
    ),
  });

  await page.waitForFunction(() => {
    const stats = (window as typeof window & { __urlStats?: { created: string[] } }).__urlStats;
    return Boolean(stats && stats.created.length > 0);
  });

  const revokedBefore = await page.evaluate(() => {
    const stats = (window as typeof window & { __urlStats?: { revoked: string[] } }).__urlStats;
    return stats?.revoked.length ?? 0;
  });

  await page.keyboard.press('Control+n');

  await page.waitForFunction((previous) => {
    const stats = (window as typeof window & { __urlStats?: { revoked: string[] } }).__urlStats;
    return Boolean(stats && stats.revoked.length > previous);
  }, revokedBefore);
});
