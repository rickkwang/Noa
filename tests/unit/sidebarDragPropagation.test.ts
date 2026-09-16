import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dragHookPath = fileURLToPath(new URL('../../src/hooks/useSidebarDrag.ts', import.meta.url));
const sidebarPath = fileURLToPath(new URL('../../src/components/Sidebar.tsx', import.meta.url));

/* The tree's drag handlers blanket every row and both root regions, and the
   only file-import handler sits above them on the sidebar root. So an OS file
   drag reaches the importer solely by bubbling through the tree: the moment a
   tree handler calls stopPropagation before it knows what the drag carries,
   dropping a file anywhere over the tree silently does nothing.

   There is no render harness in this repo, so these read the source. Brittle by
   nature, but the ordering they pin is invisible to the type system and was
   wrong for as long as the handlers existed. */
describe('sidebar tree drag handlers yield non-tree drags to the file importer', () => {
  it('parses the payload before handleDropItem claims the drop', async () => {
    const source = await readFile(dragHookPath, 'utf8');
    const body = source.slice(source.indexOf('const handleDropItem'), source.indexOf('const handleDragStartItem'));

    const parsedAt = body.indexOf('parseDraggedItem(e)');
    const bailedAt = body.indexOf('if (!item) return;');
    const claimedAt = body.indexOf('e.stopPropagation()');

    expect(parsedAt).toBeGreaterThan(-1);
    expect(bailedAt).toBeGreaterThan(parsedAt);
    expect(claimedAt).toBeGreaterThan(bailedAt);
  });

  it('checks for a drag in flight before markTarget claims the dragover', async () => {
    const source = await readFile(dragHookPath, 'utf8');
    const body = source.slice(source.indexOf('const markTarget'), source.indexOf('const handleDragTarget'));

    const bailedAt = body.indexOf('if (!draggedItem) return;');
    const claimedAt = body.indexOf('e.stopPropagation()');

    expect(bailedAt).toBeGreaterThan(-1);
    expect(claimedAt).toBeGreaterThan(bailedAt);
  });

  it('still routes file imports through the sidebar root, above the tree', async () => {
    const source = await readFile(sidebarPath, 'utf8');
    const rootElement = source.slice(source.indexOf('noa-sidebar-surface'), source.indexOf('data-testid="sidebar-file-tree"'));

    expect(rootElement).toContain('onDrop={handleDrop}');
    expect(rootElement).toContain('onDragOver={handleDragOver}');
  });
});
