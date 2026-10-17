import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

async function openWorkspace(page: Page, files: Record<string, string> | null, failDelete = false) {
  await page.addInitScript(() => {
    localStorage.setItem('redaction-storage-notice-seen', '1');
    localStorage.setItem('app-settings', JSON.stringify({ corePlugins: { dailyNotes: false } }));
  });
  await page.route(/\/src\/main\.tsx(?:\?.*)?$/, (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import { storage } from '/src/lib/storage.ts';
      import { persistHandle } from '/src/lib/fileSystemStorage.ts';
      import '/src/index.css';
      const files = ${JSON.stringify(files)};
      if (files) {
        const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('Audit', { create: true });
        for (const [path, text] of Object.entries(files)) {
          const parts = path.split('/');
          let directory = root;
          for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create: true });
          const writable = await (await directory.getFileHandle(parts.at(-1), { create: true })).createWritable();
          await writable.write(text);
          await writable.close();
        }
        await persistHandle(root);
      } else {
        await storage.saveNote({ id: 'local', title: 'Local Evidence', content: 'Local body survives Undo', folder: '',
          createdAt: '2026-01-01', updatedAt: '2026-01-01', tags: [], links: [], linkRefs: [] });
        const deleteNote = storage.deleteNote.bind(storage);
        storage.deleteNote = async (id) => {
          if (${failDelete}) throw new Error('Injected storage failure');
          await new Promise((resolve) => { window.finishDelete = resolve; });
          await deleteNote(id);
        };
      }
      const App = (await import('/src/App.tsx')).default;
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode, null, React.createElement(App)));
    `,
  }));
  await page.goto('/');
}

async function readVaultFile(page: Page, name: string) {
  return page.evaluate(async (filename) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('Audit');
    try { return await (await (await root.getFileHandle(filename)).getFile()).text(); }
    catch (error) { if ((error as DOMException).name === 'NotFoundError') return null; throw error; }
  }, name);
}

test('vault deletion has no snapshot Undo and keeps an externally recreated file', async ({ page }) => {
  await openWorkspace(page, { 'Evidence.md': 'Original evidence' });
  const tree = page.getByTestId('sidebar-file-tree');
  await tree.getByText('Evidence', { exact: true }).click();
  await tree.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(/This will permanently delete/)).toContainText('This cannot be undone.');
  await page.getByText(/This will permanently delete|You can undo this right after deleting/).locator('..').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => readVaultFile(page, 'Evidence.md')).toBeNull();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('Audit');
    const writable = await (await root.getFileHandle('Evidence.md', { create: true })).createWritable();
    await writable.write('External recreation must survive');
    await writable.close();
  });
  await expect.poll(() => readVaultFile(page, 'Evidence.md')).toBe('External recreation must survive');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
});

test('referenced vault note and folder renames are blocked while unreferenced rename still works', async ({ page }) => {
  await openWorkspace(page, {
    'Index.md': '[[Projects/Target|Evidence]] and [evidence](Projects/Target.md)',
    'Projects/Target.md': 'Original target body',
    'Unused.md': 'Unreferenced body',
  });
  const tree = page.getByTestId('sidebar-file-tree');
  await tree.getByText('Projects', { exact: true }).click();
  await tree.getByText('Target', { exact: true }).click();
  await page.getByTitle('Double-click to rename').dblclick();
  const rename = page.locator('input').filter({ visible: true }).last();
  await rename.fill('Changed');
  await rename.press('Enter');
  await expect(page.getByRole('alert')).toContainText('would break existing vault links');
  await expect(page.getByTitle('Double-click to rename')).toHaveText('Target');
  await page.getByRole('alert').getByRole('button', { name: 'Dismiss' }).click();

  await tree.getByText('Projects', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  const folderRename = tree.locator('input');
  await folderRename.fill('Archive');
  await folderRename.press('Enter');
  await expect(page.getByRole('alert')).toContainText('would break existing vault links');
  await expect(tree.getByText('Projects', { exact: true })).toBeVisible();
  await expect.poll(() => readVaultFile(page, 'Index.md')).toBe('[[Projects/Target|Evidence]] and [evidence](Projects/Target.md)');
  await page.getByRole('alert').getByRole('button', { name: 'Dismiss' }).click();

  await tree.getByText('Unused', { exact: true }).click();
  await page.getByTitle('Double-click to rename').dblclick();
  await page.locator('input').filter({ visible: true }).last().fill('Renamed');
  await page.locator('input').filter({ visible: true }).last().press('Enter');
  await expect.poll(() => readVaultFile(page, 'Renamed.md')).toBe('Unreferenced body');
  await expect.poll(() => readVaultFile(page, 'Unused.md')).toBeNull();
});

for (const failDelete of [false, true]) {
  test(`local Undo waits for a successful deletion (storage failure: ${failDelete})`, async ({ page }) => {
    await openWorkspace(page, null, failDelete);
    const tree = page.getByTestId('sidebar-file-tree');
    await tree.getByText('Local Evidence', { exact: true }).click();
    await tree.getByText('Local Evidence', { exact: true }).locator('..').locator('..').getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByText(/This will permanently delete|You can undo this right after deleting/).locator('..').getByRole('button', { name: 'Delete', exact: true }).click();
    if (failDelete) {
      await expect(page.getByRole('alert')).toContainText('Failed to delete note');
      await expect(tree.getByText('Local Evidence', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
      return;
    }
    await page.waitForFunction(() => typeof (window as any).finishDelete === 'function');
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
    await expect(tree.getByText('Local Evidence', { exact: true })).toBeVisible();
    await page.evaluate(() => (window as any).finishDelete());
    await expect(tree.getByText('Local Evidence', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(tree.getByText('Local Evidence', { exact: true })).toBeVisible();
    const saved = await page.evaluate(async () => {
      const path = '/src/lib/storage.ts';
      const { storage } = await import(path);
      return (await storage.getNotes()).find((note: any) => note.id === 'local');
    });
    expect(saved.content).toBe('Local body survives Undo');
  });
}
