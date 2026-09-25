import { expect, test } from './fixtures';

const reactModulePath = '/node_modules/.vite/deps/react.js';
const reactDomModulePath = '/node_modules/.vite/deps/react-dom_client.js';

test('connected vault images render through wiki and relative Markdown references', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async ({ reactPath, reactDomPath }) => {
    const React = (await import(reactPath)).default;
    const { createRoot } = (await import(reactDomPath)).default;
    const fsPath = '/src/lib/fileSystemStorage.ts';
    const previewPath = '/src/components/editor/PreviewPane.tsx';
    const settingsPath = '/src/hooks/useSettings.ts';
    const { scanDirectory } = await import(fsPath);
    const { PreviewPane } = await import(previewPath);
    const { defaultSettings } = await import(settingsPath);
    const dir = await navigator.storage.getDirectory();
    const notesDir = await dir.getDirectoryHandle('Notes', { create: true });
    const imageDir = await dir.getDirectoryHandle('attachments', { create: true });
    const image = await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==').then(r => r.blob());
    for (const [parent, name, content] of [
      [notesDir, 'Note.md', '![[attachments/photo.png]]\n\n![relative](../attachments/photo.png)'],
      [imageDir, 'photo.png', image],
    ] as const) {
      const file = await parent.getFileHandle(name, { create: true });
      const writer = await file.createWritable();
      await writer.write(content);
      await writer.close();
    }
    const { notes, folders } = await scanDirectory(dir, []);
    const urls = new Map();
    for (const a of notes[0].attachments ?? []) {
      const blob = await fetch(`data:${a.mimeType};base64,${a.dataBase64}`).then(r => r.blob());
      urls.set(a.id, URL.createObjectURL(blob));
    }
    const host = document.createElement('div');
    host.id = 'vault-image-regression';
    document.body.append(host);
    createRoot(host).render(React.createElement(PreviewPane, {
      note: notes[0], allNotes: notes, folders, settings: defaultSettings,
      editorStyle: {}, contentMaxWidthStyle: {}, objectUrls: urls,
      onNavigateToNoteLegacy: () => {}, onNavigateToNoteById: () => {},
    }));
  }, { reactPath: reactModulePath, reactDomPath: reactDomModulePath });
  const images = page.locator('#vault-image-regression img');
  await expect(images).toHaveCount(2);
  for (const image of await images.all()) {
    await expect(image).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  }
});

test('Vault ZIP keeps attachment references usable after folder import', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async ({ reactPath, reactDomPath }) => {
    const React = (await import(reactPath)).default;
    const { createRoot } = (await import(reactDomPath)).default;
    const transferPath = '/src/hooks/useDataTransfer.ts';
    const storagePath = '/src/lib/storage.ts';
    const zipPath = '/node_modules/.vite/deps/jszip.js';
    const { useDataTransfer, buildVaultImportPayload } = await import(transferPath);
    const { storage } = await import(storagePath);
    const JSZip = (await import(zipPath)).default;
    const at = new Date().toISOString();
    const note = { id: 'note', title: 'Architecture', content: '![[a/diagram.png]]\n![[diagram.png]]\n![diagram](diagram.png)', folder: 'docs', createdAt: at, updatedAt: at, tags: [], links: [], attachments: [
      { id: 'other', noteId: 'note', filename: 'diagram.png', vaultPath: 'a/diagram.png', mimeType: 'image/png', size: 5, createdAt: at },
      { id: 'image', noteId: 'note', filename: 'diagram.png', vaultPath: 'diagram.png', mimeType: 'image/png', size: 5, createdAt: at },
    ] };
    await storage.saveAttachmentBlob('image', new Blob(['image'], { type: 'image/png' }));
    await storage.saveAttachmentBlob('other', new Blob(['other'], { type: 'image/png' }));
    let api: any;
    let download: Blob | undefined;
    const original = URL.createObjectURL;
    URL.createObjectURL = blob => { download = blob as Blob; return original(blob); };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    function Harness() {
      api = useDataTransfer({ notes: [note], folders: [{ id: 'docs', name: 'Docs' }], workspaceName: 'Audit', notify: () => {} });
      return null;
    }
    try {
      root.render(React.createElement(Harness));
      while (!api) await new Promise(resolve => setTimeout(resolve, 10));
      await api.exportZip();
      const zip = await JSZip.loadAsync(await download!.arrayBuffer());
      const files = [];
      for (const entry of Object.values(zip.files) as any[]) {
        if (entry.dir || ['manifest.json', 'README.md'].includes(entry.name)) continue;
        files.push({ pathSegments: ['Audit', ...entry.name.split('/')], file: new File([await entry.async('uint8array')], entry.name.split('/').pop()) });
      }
      const imported = await buildVaultImportPayload(files, new Map());
      return imported.notes.map((n: any) => ({ title: n.title, attachments: n.attachments?.length ?? 0 }));
    } finally { URL.createObjectURL = original; root.unmount(); host.remove(); }
  }, { reactPath: reactModulePath, reactDomPath: reactDomModulePath });
  expect(result).toEqual([{ title: 'Architecture', attachments: 2 }]);
});

test('Mermaid preview retains readable SVG labels and styling', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.locator('.cm-content').fill('```mermaid\ngraph TD; A[Start] --> B[Finish]\n```');
  await page.getByRole('button', { name: 'Switch to preview view' }).click();
  const label = page.locator('svg text').filter({ hasText: 'Start' });
  await expect(label).toBeVisible();
  await expect(page.locator('svg text').filter({ hasText: 'Finish' })).toBeVisible();
  const finalSvg = page.locator('svg[id^="mermaid-"]').filter({ hasText: 'Start' });
  await expect(finalSvg.locator('foreignObject, script')).toHaveCount(0);
  await expect(finalSvg.locator('.node rect').first()).not.toHaveCSS('fill', 'rgb(0, 0, 0)');
});

test('find keeps focus and repeated replacements use current document positions', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  const editor = page.locator('.cm-content');
  await editor.fill('apple apple');
  await editor.press('ControlOrMeta+f');
  const find = page.getByPlaceholder('Find…');
  await expect(find).toBeFocused();
  await find.pressSequentially('apple');
  await expect(find).toHaveValue('apple');
  await expect(find).toBeFocused();
  await expect(editor).toContainText('apple apple');
  await page.getByRole('button', { name: 'Show replace' }).click();
  await page.getByPlaceholder('Replace…').fill('X');
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(editor).toContainText('X apple');
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(editor).toContainText('X X');
  await expect(page.getByRole('button', { name: 'Replace', exact: true })).toBeDisabled();
  await editor.fill('apple tail');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(editor).toContainText('X tail');
});

for (const action of ['move', 'restore'] as const) {
  test(`closing waits for a pending ${action} and preserves it on failure`, async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async ({ reactPath, reactDomPath, action }) => {
      const React = (await import(reactPath)).default;
      const { createRoot } = (await import(reactDomPath)).default;
      const hookPath = '/src/hooks/useNotes.ts';
      const storagePath = '/src/lib/storage.ts';
      const rescuePath = '/src/lib/importRescue.ts';
      const { useNotes } = await import(hookPath);
      const { storage } = await import(storagePath);
      const { peekRescuedNotes } = await import(rescuePath);
      const host = document.createElement('div');
      document.body.append(host);
      let api: any;
      function Harness() { api = useNotes(); return null; }
      const root = createRoot(host);
      root.render(React.createElement(Harness));
      const waitUntil = async (predicate: () => boolean) => {
        const deadline = Date.now() + 5000;
        while (!predicate()) {
          if (Date.now() > deadline) throw new Error('Mutation did not reach expected state');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      };
      await waitUntil(() => api?.isLoaded && api.folders.length > 0);
      const noteId = api.handleCreateNote('', 'close mutation test');
      await waitUntil(() => api.notes.some((n: any) => n.id === noteId));
      const note = api.notes.find((n: any) => n.id === noteId);
      await api.flushAllPendingSaves(undefined, true);
      const originalSave = storage.saveNote;
      let rejectWrite!: (error: Error) => void;
      let entered = false;
      storage.saveNote = () => new Promise((_resolve, reject) => { entered = true; rejectWrite = reject; });
      try {
        const mutation = action === 'move'
          ? api.handleMoveNote(note.id, api.folders.find((f: any) => f.id !== note.folder).id)
          : api.restoreSnapshot({ noteId: note.id, title: note.title, content: 'restored text', savedAt: new Date().toISOString() });
        await waitUntil(() => entered);
        let settled = false;
        let refused = false;
        const closing = api.flushAllPendingSaves(undefined, true).catch(() => { refused = true; }).finally(() => { settled = true; });
        await new Promise(resolve => setTimeout(resolve, 100));
        const premature = settled;
        storage.saveNote = async () => { throw new Error('disk full'); };
        rejectWrite(new Error('disk full'));
        await mutation;
        await closing;
        return { premature, refused, rescued: peekRescuedNotes().some((n: any) => n.id === note.id) };
      } finally {
        storage.saveNote = originalSave;
        root.unmount();
        host.remove();
      }
    }, { reactPath: reactModulePath, reactDomPath: reactDomModulePath, action });
    expect(result).toEqual({ premature: false, refused: true, rescued: true });
  });
}

test('replacing a vault attachment refreshes its existing preview URL', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async ({ reactPath, reactDomPath }) => {
    const React = (await import(reactPath)).default;
    const { createRoot } = (await import(reactDomPath)).default;
    const hookPath = '/src/hooks/useAttachments.ts';
    const storagePath = '/src/lib/storage.ts';
    const { useAttachments } = await import(hookPath);
    const { storage } = await import(storagePath);
    const attachment = { id: 'preview-refresh', noteId: 'preview-note', filename: 'photo.png', mimeType: 'image/png', size: 6, createdAt: '2026-01-01T00:00:00Z', vaultPath: 'attachments/photo.png' };
    await storage.saveAttachmentBlob(attachment.id, new Blob(['before']));
    const host = document.createElement('div');
    document.body.append(host);
    let changeNote: any;
    function Harness() {
      const [note, setNote] = React.useState({ id: attachment.noteId, attachments: [attachment] });
      changeNote = setNote;
      const { objectUrls } = useAttachments(note, () => {});
      return React.createElement('a', { href: objectUrls.get(attachment.id) }, 'attachment');
    }
    const root = createRoot(host);
    root.render(React.createElement(Harness));
    const waitForUrl = async (old?: string) => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const href = host.querySelector('a')?.getAttribute('href');
        if (href && href !== old) return href;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return host.querySelector('a')?.getAttribute('href');
    };
    try {
      const beforeUrl = await waitForUrl();
      if (!beforeUrl) throw new Error('Initial attachment did not load');
      const before = await (await fetch(beforeUrl)).text();
      await storage.saveAttachmentBlob(attachment.id, new Blob(['after!']));
      changeNote({ id: attachment.noteId, attachments: [{ ...attachment, createdAt: '2026-01-02T00:00:00Z' }] });
      const afterUrl = await waitForUrl(beforeUrl);
      return { before, after: await (await fetch(afterUrl!)).text(), changed: beforeUrl !== afterUrl };
    } finally {
      root.unmount();
      host.remove();
    }
  }, { reactPath: reactModulePath, reactDomPath: reactDomModulePath });
  expect(result).toEqual({ before: 'before', after: 'after!', changed: true });
});

test('CodeMirror applies a same-note external A-B-A transition', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async ({ reactPath, reactDomPath }) => {
    const React = (await import(reactPath)).default;
    const { createRoot } = (await import(reactDomPath)).default;
    const hookPath = '/src/components/editor/useCodeMirror.ts';
    const { useCodeMirror } = await import(hookPath);

    document.body.innerHTML = '<div id="hook-regression-root"></div>';
    const api: Record<string, unknown> = {};
    const waitUntil = async (predicate: () => boolean, timeoutMs = 2_000) => {
      const deadline = performance.now() + timeoutMs;
      while (!predicate()) {
        if (performance.now() >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return true;
    };
    const baseNote = {
      id: 'same-note',
      title: 'Test',
      content: 'initial',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      folder: '',
      tags: [],
      links: [],
      linkRefs: [],
      source: 'noa',
    };

    function Harness() {
      const [note, setNote] = React.useState(baseNote);
      const containerRef = React.useRef(null);
      const editPaneRef = React.useRef(null);
      const hook = useCodeMirror({
        containerRef,
        editPaneRef,
        note,
        isDark: false,
        maxWidth: 'none',
        onUpdate: (content: string) => setNote((prev: typeof baseNote) => ({ ...prev, content })),
        onMentionTrigger: () => {},
        onSlashTrigger: () => {},
      });
      React.useEffect(() => {
        api.setExternal = (content: string) => setNote((prev: typeof baseNote) => ({ ...prev, content }));
        api.viewRef = hook.editorViewRef;
        api.noteContent = note.content;
      });
      return React.createElement(
        'div',
        { ref: editPaneRef },
        React.createElement('div', { ref: containerRef }),
      );
    }

    createRoot(document.getElementById('hook-regression-root')).render(React.createElement(Harness));
    await waitUntil(() => Boolean(api.viewRef));

    const viewRef = api.viewRef as {
      current: {
        state: { doc: { length: number; toString(): string } };
        dispatch(arg: unknown): void;
      };
    };
    viewRef.current.dispatch({
      changes: { from: 0, to: viewRef.current.state.doc.length, insert: 'A' },
    });
    await waitUntil(() => api.noteContent === 'A');
    (api.setExternal as (content: string) => void)('B');
    await waitUntil(() => viewRef.current.state.doc.toString() === 'B');
    const afterB = viewRef.current.state.doc.toString();
    (api.setExternal as (content: string) => void)('A');
    await waitUntil(() => viewRef.current.state.doc.toString() === 'A');
    return { afterB, afterRestoreA: viewRef.current.state.doc.toString() };
  }, { reactPath: reactModulePath, reactDomPath: reactDomModulePath });

  expect(result).toEqual({ afterB: 'B', afterRestoreA: 'A' });
});

test('sidebar search keeps the latest query when an older refresh is pending', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async ({ reactPath, reactDomPath }) => {
    const React = (await import(reactPath)).default;
    const { createRoot } = (await import(reactDomPath)).default;
    const searchEnginePath = '/src/core/search.ts';
    const { SearchEngine } = await import(searchEnginePath);
    const originalUpdateNotes = SearchEngine.prototype.updateNotes;
    let updateNotesCalls = 0;
    SearchEngine.prototype.updateNotes = function(this: unknown, ...args: unknown[]) {
      updateNotesCalls += 1;
      return originalUpdateNotes.apply(this, args);
    };
    const hookPath = '/src/hooks/useSidebarSearch.ts';
    const { useSidebarSearch } = await import(hookPath);

    document.body.innerHTML = '<div id="hook-regression-root"></div>';
    const api: Record<string, unknown> = {};
    const waitUntil = async (predicate: () => boolean, timeoutMs = 2_000) => {
      const deadline = performance.now() + timeoutMs;
      while (!predicate()) {
        if (performance.now() >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return true;
    };
    const makeNote = (id: string, title: string) => ({
      id,
      title,
      content: title,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      folder: '',
      tags: [],
      links: [],
      linkRefs: [],
      source: 'noa',
    });
    const stableFolders: never[] = [];

    function Harness() {
      const [notes, setNotes] = React.useState([
        makeNote('old', 'oldquery'),
        makeNote('new', 'newquery'),
      ]);
      const [query, setQuery] = React.useState('oldquery');
      const results = useSidebarSearch({
        notes,
        folders: stableFolders,
        searchQuery: query,
        caseSensitive: false,
        fuzzySearch: false,
      });
      React.useEffect(() => {
        api.bumpNotes = () => setNotes((prev: ReturnType<typeof makeNote>[]) =>
          prev.map((note) => ({ ...note, updatedAt: `${note.updatedAt}x` }))
        );
        api.setQuery = setQuery;
        api.notesVersion = notes[0]?.updatedAt;
      });
      return React.createElement(
        'pre',
        { id: 'search-result-ids' },
        results.map((item: { note: { id: string } }) => item.note.id).join(','),
      );
    }

    createRoot(document.getElementById('hook-regression-root')).render(React.createElement(Harness));
    await waitUntil(() => document.getElementById('search-result-ids')?.textContent === 'old');
    (api.bumpNotes as () => void)();
    await waitUntil(() => String(api.notesVersion).endsWith('x'));
    (api.setQuery as (query: string) => void)('newquery');
    await waitUntil(() => document.getElementById('search-result-ids')?.textContent === 'new');
    const beforePendingRefresh = document.getElementById('search-result-ids')?.textContent ?? '';
    await new Promise((resolve) => setTimeout(resolve, 300));
    const afterPendingRefresh = document.getElementById('search-result-ids')?.textContent ?? '';
    const callsBeforeQueryOnlyChanges = updateNotesCalls;
    (api.setQuery as (query: string) => void)('oldquery');
    await waitUntil(() => document.getElementById('search-result-ids')?.textContent === 'old');
    (api.setQuery as (query: string) => void)('newquery');
    await waitUntil(() => document.getElementById('search-result-ids')?.textContent === 'new');
    const indexRefreshesForQueryOnlyChanges = updateNotesCalls - callsBeforeQueryOnlyChanges;
    const callsBeforeClear = updateNotesCalls;
    (api.setQuery as (query: string) => void)('');
    (api.bumpNotes as () => void)();
    await waitUntil(() => document.getElementById('search-result-ids')?.textContent === '');
    await new Promise((resolve) => setTimeout(resolve, 300));
    SearchEngine.prototype.updateNotes = originalUpdateNotes;
    return {
      beforePendingRefresh,
      afterPendingRefresh,
      indexRefreshesForQueryOnlyChanges,
      indexRefreshesAfterClear: updateNotesCalls - callsBeforeClear,
    };
  }, { reactPath: reactModulePath, reactDomPath: reactDomModulePath });

  expect(result).toEqual({
    beforePendingRefresh: 'new',
    afterPendingRefresh: 'new',
    indexRefreshesForQueryOnlyChanges: 0,
    indexRefreshesAfterClear: 0,
  });
});

test('closing waits for slow note writes and refuses failed saves', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async ({ reactPath, reactDomPath }) => {
    const React = (await import(reactPath)).default;
    const { createRoot } = (await import(reactDomPath)).default;
    const hookPath = '/src/hooks/useNotes.ts';
    const storagePath = '/src/lib/storage.ts';
    const rescuePath = '/src/lib/importRescue.ts';
    const { useNotes } = await import(hookPath);
    const { storage } = await import(storagePath);
    const { peekRescuedNotes } = await import(rescuePath);
    const host = document.createElement('div');
    document.body.append(host);
    let api: any;
    function Harness() { api = useNotes(); return null; }
    const root = createRoot(host);
    root.render(React.createElement(Harness));
    const waitUntil = async (condition: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (!condition()) {
        if (Date.now() > deadline) throw new Error('Hook did not reach expected state');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    };
    await waitUntil(() => api?.isLoaded && api.notes.length > 0);
    const id = api.notes[0].id;
    const originalSave = storage.saveNote;
    let release!: () => void;
    let entered = false;
    storage.saveNote = async (note: unknown) => {
      entered = true;
      await new Promise<void>(resolve => { release = resolve; });
      await originalSave(note);
    };
    try {
      api.handleUpdateNote(id, 'close regression slow edit');
      await waitUntil(() => api.notes.find((n: any) => n.id === id)?.content === 'close regression slow edit');
      let finished = false;
      const pending = api.flushAllPendingSaves(undefined, true).then(() => { finished = true; });
      await waitUntil(() => entered);
      const parked = peekRescuedNotes().some((n: any) => n.id === id && n.content === 'close regression slow edit');
      await new Promise(resolve => setTimeout(resolve, 900));
      const early = finished;
      release();
      await pending;
      storage.saveNote = async () => { throw new Error('disk full'); };
      api.handleUpdateNote(id, 'close regression failed edit');
      await waitUntil(() => api.notes.find((n: any) => n.id === id)?.content === 'close regression failed edit');
      let refused = false;
      try { await api.flushAllPendingSaves(undefined, true); } catch { refused = true; }
      const rescued = peekRescuedNotes().some((n: any) => n.id === id && n.content === 'close regression failed edit');
      return { early, finished, parked, refused, rescued };
    } finally {
      storage.saveNote = originalSave;
      root.unmount();
      host.remove();
    }
  }, { reactPath: reactModulePath, reactDomPath: reactDomModulePath });
  expect(result).toEqual({ early: false, finished: true, parked: true, refused: true, rescued: true });
});
