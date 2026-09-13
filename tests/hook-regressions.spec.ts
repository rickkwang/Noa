import { expect, test } from './fixtures';

const reactModulePath = '/node_modules/.vite/deps/react.js';
const reactDomModulePath = '/node_modules/.vite/deps/react-dom_client.js';

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
