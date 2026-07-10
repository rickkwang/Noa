import { expect, test } from '@playwright/test';

const reactModulePath = '/node_modules/.vite/deps/react.js';
const reactDomModulePath = '/node_modules/.vite/deps/react-dom_client.js';

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
