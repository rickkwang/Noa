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

async function waitForFoldersPersisted(page: import('@playwright/test').Page, expectedPaths: string[]) {
  await page.waitForFunction(
    async (paths) => {
      const request = indexedDB.open('redaction-diary-folders-db');
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
      if (!db) return false;

      const tx = db.transaction('folders', 'readonly');
      const store = tx.objectStore('folders');
      const folders = await new Promise<any[]>((resolve) => {
        const out: any[] = [];
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) {
            resolve(out);
            return;
          }
          out.push(cursor.value);
          cursor.continue();
        };
        cursorReq.onerror = () => resolve([]);
      });

      db.close();
      const names = new Set(folders.filter((folder) => folder && typeof folder.name === 'string').map((folder) => folder.name));
      return paths.every((path) => names.has(path));
    },
    expectedPaths,
    { timeout: 10_000 },
  );
}

async function waitForAttachmentPersisted(page: import('@playwright/test').Page, filename: string) {
  await page.waitForFunction(
    async (target) => {
      const noteRequest = indexedDB.open('redaction-diary-notes-db');
      const noteDb = await new Promise<IDBDatabase | null>((resolve) => {
        noteRequest.onsuccess = () => resolve(noteRequest.result);
        noteRequest.onerror = () => resolve(null);
      });
      if (!noteDb) return false;

      const notes = await new Promise<any[]>((resolve) => {
        const tx = noteDb.transaction('notes', 'readonly');
        const store = tx.objectStore('notes');
        const out: any[] = [];
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) {
            resolve(out);
            return;
          }
          out.push(cursor.value);
          cursor.continue();
        };
        cursorReq.onerror = () => resolve([]);
      });
      noteDb.close();

      const attachment = notes
        .flatMap((note) => note?.attachments ?? [])
        .find((candidate) => candidate && candidate.filename === target);
      if (!attachment?.id) return false;

      const blobRequest = indexedDB.open('redaction-diary-attachments-db');
      const blobDb = await new Promise<IDBDatabase | null>((resolve) => {
        blobRequest.onsuccess = () => resolve(blobRequest.result);
        blobRequest.onerror = () => resolve(null);
      });
      if (!blobDb) return false;

      const blob = await new Promise<Blob | null>((resolve) => {
        const tx = blobDb.transaction('attachments', 'readonly');
        const store = tx.objectStore('attachments');
        const getReq = store.get(`blob:${attachment.id}`);
        getReq.onsuccess = () => resolve((getReq.result as Blob | null) ?? null);
        getReq.onerror = () => resolve(null);
      });
      blobDb.close();
      return blob instanceof Blob && blob.size > 0;
    },
    filename,
    { timeout: 10_000 },
  );
}

async function ensureEditMode(page: import('@playwright/test').Page) {
  await page.locator('[title="Edit Only"]').click();
  await expect(page.locator('.cm-content').first()).toBeVisible();
}

async function createNewNote(page: import('@playwright/test').Page) {
  await page.getByTitle('New note').click();
  await ensureEditMode(page);
}

async function installMockDirectoryPicker(
  page: import('@playwright/test').Page,
) {
  await page.addInitScript(async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const syncMode = { failWrites: false };
    (window as typeof window & { __syncMode?: typeof syncMode }).__syncMode = syncMode;
    (window as typeof window & { __pickerInvoked?: boolean }).__pickerInvoked = false;

    class MockFileHandle {
      kind = 'file' as const;
      name: string;
      content = '';
      mimeType = '';
      binaryBase64: string | null = null;

      constructor(name: string, mimeType = '') {
        this.name = name;
        this.mimeType = mimeType;
      }

      async getFile() {
        const binary = this.binaryBase64
          ? Uint8Array.from(atob(this.binaryBase64), (char) => char.charCodeAt(0))
          : this.content;
        return new File([binary], this.name, {
          lastModified: Date.now(),
          type: this.mimeType,
        });
      }

      async createWritable() {
        await delay(40);
        if (syncMode.failWrites) {
          throw new DOMException('blocked', 'NotAllowedError');
        }
        const fileHandle = this;
        return {
          async write(value: string | Blob) {
            await delay(40);
            if (value instanceof Blob) {
              fileHandle.mimeType = value.type;
              fileHandle.content = await value.text();
              fileHandle.binaryBase64 = btoa(String.fromCharCode(...new Uint8Array(await value.arrayBuffer())));
              return;
            }
            fileHandle.content = value;
            fileHandle.binaryBase64 = null;
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

    const seedFromPath = (
      root: MockDirectoryHandle,
      path: string,
      content?: string,
      base64?: string,
      type?: string,
    ) => {
      const parts = path.split('/').filter(Boolean);
      if (parts.length === 0) return;
      let current: MockDirectoryHandle = root;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const dirName = parts[i];
        const existing = current.entriesMap.get(dirName);
        if (existing instanceof MockDirectoryHandle) {
          current = existing;
          continue;
        }
        const next = new MockDirectoryHandle(dirName);
        current.entriesMap.set(dirName, next);
        current = next;
      }
      const fileName = parts[parts.length - 1];
      const file = new MockFileHandle(fileName, type ?? '');
      if (typeof content === 'string') {
        file['content'] = content;
      }
      if (typeof base64 === 'string') {
        file['binaryBase64'] = base64;
      }
      current.entriesMap.set(fileName, file);
    };

    const picker: NonNullable<typeof window.showDirectoryPicker> = async () => {
      await delay(30);
      (window as typeof window & { __pickerInvoked?: boolean }).__pickerInvoked = true;
      const seed = (window as typeof window & {
        __pickerSeed?: { rootName?: string; dirs?: string[]; files?: Array<{ path: string; content?: string; base64?: string; type?: string }> };
      }).__pickerSeed;
      const root = new MockDirectoryHandle(seed?.rootName || 'mock-vault');
      if (seed) {
        (seed.dirs ?? []).forEach((dirPath) => {
          const parts = dirPath.split('/').filter(Boolean);
          let current = root;
          for (const part of parts) {
            const existing = current.entriesMap.get(part);
            if (existing instanceof MockDirectoryHandle) {
              current = existing;
              continue;
            }
            const next = new MockDirectoryHandle(part);
            current.entriesMap.set(part, next);
            current = next;
          }
        });
        (seed.files ?? []).forEach(({ path, content, base64, type }) => seedFromPath(root, path, content, base64, type));
      }
      return root as unknown as FileSystemDirectoryHandle;
    };
    try {
      // Some browsers expose a native directory picker that is not writable;
      // delete first so the mock reliably shadows it in Playwright.
      delete (window as typeof window & { showDirectoryPicker?: unknown }).showDirectoryPicker;
    } catch {
      // Best effort only.
    }
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      writable: true,
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

  await createNewNote(page);

  await page.locator('.cm-content').last().click();
  await page.keyboard.type(`# ${marker}\n\n- [ ] task`);
  await waitForMarkerPersisted(page, marker);
  await page.reload();
  await waitForMarkerPersisted(page, marker);
});

test('wiki-link preview mode is reachable', async ({ page }) => {
  const linkedTitle = `Linked-${Date.now()}`;
  await page.goto('/');
  await createNewNote(page);
  await page.locator('.cm-content').first().click();
  await page.keyboard.type(`Jump to [[${linkedTitle}]]`);
  await page.getByTitle('Preview Only').click();
  await expect(page.getByTitle('Preview Only')).toBeVisible();
});

test('preview renders headings, table, math, callout, footnote, and task list', async ({ page }) => {
  const marker = `render-${Date.now()}`;
  await page.goto('/');
  await createNewNote(page);
  await page.locator('.cm-content').first().click();
  await page.keyboard.type(`# ${marker}

Inline code: \`@anthropic-ai/sandbox-runtime\`

| Col A | Col B |
| --- | --- |
| 1 | 2 |

Inline math: $a^2 + b^2 = c^2$

$$
E = mc^2
$$

> [!NOTE]
> callout body

- [ ] unchecked task
- [x] checked task

Footnote ref[^1]

[^1]: footnote body
`);

  await waitForMarkerPersisted(page, marker);
  await page.getByTitle('Preview Only').click();

  const preview = page.locator('.prose').last();
  await expect(preview.getByText(marker, { exact: true })).toBeVisible();
  await expect(preview.getByText('@anthropic-ai/sandbox-runtime', { exact: true })).toBeVisible();
  await expect(preview.getByRole('columnheader', { name: 'Col A' })).toBeVisible();
  await expect(preview.getByRole('columnheader', { name: 'Col B' })).toBeVisible();
  await expect(preview.locator('.katex').first()).toBeVisible();
  await expect(preview.getByText('callout body')).toBeVisible();
  await expect(preview.getByText('footnote body')).toBeVisible();
  await expect(preview.locator('li.task-list-item')).toHaveCount(2);
});

test('invalid JSON import is blocked with readable error', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Data' }).click();

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
  await page.getByRole('tab', { name: 'Data' }).click();
  await expect(page.getByRole('button', { name: 'Export JSON' })).toBeVisible();
});

test('reset and import recovery flow uses confirmation', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Data' }).click();
  await page.getByRole('button', { name: 'New Workspace' }).click();
  await expect(page.getByText(/this will clear current data/i)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText(/this will clear current data/i)).toBeHidden();
});

test('graph tab opens in right panel', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('Toggle Panel').click();
  await expect(page.getByRole('button', { name: 'Graph', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tasks' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Links' })).toBeVisible();
});

test('vault import entry is labeled as migration', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Data' }).click();
  await expect(page.getByRole('button', { name: 'Import Vault Folder' })).toBeVisible();
});

test('vault import preserves nested folder structure', async ({ page }) => {
  const vaultSuffix = `vault-${Date.now()}`;
  await installMockDirectoryPicker(page);
  await page.goto('/');

  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Data' }).click();
  await expect(page.getByRole('button', { name: 'Import Vault Folder' })).toBeVisible();
  await page.evaluate((suffix) => {
    (window as typeof window & {
      __pickerSeed?: { rootName?: string; dirs?: string[]; files?: Array<{ path: string; content?: string }> };
    }).__pickerSeed = {
      rootName: `Projects-${suffix}`,
      dirs: [
        `Projects-${suffix}/Noa`,
        `Projects-${suffix}/Noa/Specs`,
        `Projects-${suffix}/Noa/empty-folder`,
      ],
      files: [
        { path: `Projects-${suffix}/Noa/Specs/plan.md`, content: '# Plan\n\nVault import test.' },
        { path: `Projects-${suffix}/root-note.md`, content: '# Root Note\n\nVault import test.' },
      ],
    };
  }, vaultSuffix);
  await page.getByRole('button', { name: 'Import Vault Folder' }).click();
  await page.waitForFunction(() => (window as typeof window & { __pickerInvoked?: boolean }).__pickerInvoked === true, null, { timeout: 5_000 });
  await expect(page.getByRole('button', { name: 'Confirm' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await waitForFoldersPersisted(page, [
    `Projects-${vaultSuffix}`,
    `Projects-${vaultSuffix}/Noa`,
    `Projects-${vaultSuffix}/Noa/Specs`,
    `Projects-${vaultSuffix}/Noa/empty-folder`,
  ]);

  const fileTree = page.getByTestId('sidebar-file-tree');
  await expect(fileTree.getByText(`Projects-${vaultSuffix}`, { exact: true }).first()).toBeVisible();
});

test('vault import keeps nested README notes and restores referenced image attachments', async ({ page }) => {
  const vaultSuffix = `vault-attachments-${Date.now()}`;
  await installMockDirectoryPicker(page);
  await page.goto('/');

  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Data' }).click();
  await page.evaluate((suffix) => {
    (window as typeof window & {
      __pickerSeed?: { rootName?: string; dirs?: string[]; files?: Array<{ path: string; content?: string; base64?: string; type?: string }> };
    }).__pickerSeed = {
      rootName: `Vault-${suffix}`,
      dirs: [
        `Vault-${suffix}/Docs`,
        `Vault-${suffix}/assets`,
      ],
      files: [
        { path: `Vault-${suffix}/README.md`, content: '# Export Readme\n\nShould stay skipped.' },
        { path: `Vault-${suffix}/Docs/README.md`, content: '# Nested Readme\n\nnested-readme-marker' },
        { path: `Vault-${suffix}/Docs/guide.md`, content: '# Guide\n\n![[../assets/pixel.png]]' },
        {
          path: `Vault-${suffix}/assets/pixel.png`,
          base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wf5K5sAAAAASUVORK5CYII=',
          type: 'image/png',
        },
      ],
    };
  }, vaultSuffix);

  await page.getByRole('button', { name: 'Import Vault Folder' }).click();
  await expect(page.getByRole('button', { name: 'Confirm' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();

  await waitForMarkerPersisted(page, 'nested-readme-marker');
  await waitForAttachmentPersisted(page, 'pixel.png');
  await page.waitForFunction(async () => {
    const request = indexedDB.open('redaction-diary-notes-db');
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    if (!db) return false;

    const notes = await new Promise<any[]>((resolve) => {
      const tx = db.transaction('notes', 'readonly');
      const store = tx.objectStore('notes');
      const out: any[] = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        out.push(cursor.value);
        cursor.continue();
      };
      cursorReq.onerror = () => resolve([]);
    });
    db.close();

    return notes.some((note) =>
      note?.title === 'guide'
      && typeof note?.content === 'string'
      && note.content.includes('![[../assets/pixel.png]]')
      && Array.isArray(note?.attachments)
      && note.attachments.some((attachment: { filename?: string; vaultPath?: string }) =>
        attachment.filename === 'pixel.png' && attachment.vaultPath === '../assets/pixel.png')
    );
  }, { timeout: 10_000 });
});

test('multi-tab content persists after closing and reopening tabs', async ({ page }) => {
  const markerA = `tab-a-${Date.now()}`;
  const markerB = `tab-b-${Date.now() + 1}`;
  await page.goto('/');

  // Create note A
  await createNewNote(page);
  await page.locator('.cm-content').last().click();
  await page.keyboard.type(`# ${markerA}`);
  await waitForMarkerPersisted(page, markerA);

  // Create note B in a new tab
  await createNewNote(page);
  await page.locator('.cm-content').last().click();
  await page.keyboard.type(`# ${markerB}`);
  await waitForMarkerPersisted(page, markerB);

  // Both note bodies should still exist in IndexedDB after reload.
  await page.reload();
  await waitForMarkerPersisted(page, markerA);
  await waitForMarkerPersisted(page, markerB);
});

test('filesystem sync control and status are visible in data settings', async ({ page }) => {
  await installMockDirectoryPicker(page);
  await page.goto('/');
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Data' }).click();
  await expect(page.getByText('Vault Folder', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Connect Folder|Disconnect/ })).toBeVisible();
});

test('filesystem sync status transitions from syncing to ready on retry', async ({ page }) => {
  await installMockDirectoryPicker(page);
  await page.goto('/');
  await page.evaluate(() => {
    (window as typeof window & {
      __pickerSeed?: { rootName?: string; dirs?: string[]; files?: Array<{ path: string; content?: string }> };
    }).__pickerSeed = {
      rootName: 'mock-vault',
      files: [{ path: 'Synced.md', content: '# Synced\n\nFrom vault.' }],
    };
  });
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Data' }).click();
  await page.getByRole('button', { name: 'Connect Folder' }).click();

  await expect(page.getByText(/Sync status: ready/i)).toBeVisible();
  await page.getByRole('button', { name: 'Retry Sync' }).click();
  await expect(page.getByText(/Sync status: ready/i)).toBeVisible();
});

test('filesystem sync status transitions from syncing to error on retry', async ({ page }) => {
  await installMockDirectoryPicker(page);
  await page.goto('/');
  await page.evaluate(() => {
    (window as typeof window & {
      __pickerSeed?: { rootName?: string; dirs?: string[]; files?: Array<{ path: string; content?: string }> };
    }).__pickerSeed = {
      rootName: 'mock-vault',
      files: [{ path: 'Synced.md', content: '# Synced\n\nFrom vault.' }],
    };
  });
  await page.getByTitle('Settings').click();
  await page.getByRole('tab', { name: 'Data' }).click();
  await page.getByRole('button', { name: 'Connect Folder' }).click();

  await expect(page.getByText(/Sync status: ready/i)).toBeVisible();
  await page.evaluate(() => {
    const syncMode = (window as typeof window & { __syncMode?: { failWrites: boolean } }).__syncMode;
    if (syncMode) syncMode.failWrites = true;
  });
  await page.getByRole('button', { name: 'Retry Sync' }).click();
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

  await createNewNote(page);
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

  await createNewNote(page);

  await page.waitForFunction((previous) => {
    const stats = (window as typeof window & { __urlStats?: { revoked: string[] } }).__urlStats;
    return Boolean(stats && stats.revoked.length > previous);
  }, revokedBefore);
});
