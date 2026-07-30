import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sidebarPath = fileURLToPath(new URL('../../src/components/Sidebar.tsx', import.meta.url));
const fileNodePath = fileURLToPath(new URL('../../src/components/sidebar/FileNode.tsx', import.meta.url));
const appPath = fileURLToPath(new URL('../../src/App.tsx', import.meta.url));
const rightPanelPath = fileURLToPath(new URL('../../src/components/RightPanel.tsx', import.meta.url));

describe('sidebar search result layout', () => {
  it('insets search result rows to balance the reserved scrollbar gutter', async () => {
    const source = await readFile(sidebarPath, 'utf8');

    expect(source).not.toContain('className="-mr-[5px]"');
    expect(source).toContain('p-2 ml-1 mb-1.5 rounded-md cursor-pointer border-l-2');
  });

  it('lets the sidebar toolbar inherit the sidebar background', async () => {
    const source = await readFile(sidebarPath, 'utf8');

    expect(source).toContain('className="h-8 flex items-center px-2 gap-0.5 shrink-0 z-10 overflow-hidden"');
    expect(source).not.toContain('className="h-8 border-b flex items-center px-2 gap-0.5 shrink-0 z-10 overflow-hidden"');
    expect(source).not.toContain('shrink-0 bg-[#EFEAE3] z-10 overflow-hidden');
    expect(source).not.toContain("borderBottomColor: 'var(--panel-divider, #2D2D2B)'");
  });

  it('keeps the daily-note shortcut in the sidebar instead of duplicating it in the title bar', async () => {
    const [sidebar, topBar] = await Promise.all([
      readFile(sidebarPath, 'utf8'),
      readFile(fileURLToPath(new URL('../../src/components/TopBar.tsx', import.meta.url)), 'utf8'),
    ]);

    expect(sidebar).toContain('aria-label="Open today\'s daily note"');
    expect(topBar).not.toContain('aria-label="Open today\'s daily note"');
  });

  it('keeps the mirrored vault label unruled above its folder list', async () => {
    const [source, fileNode] = await Promise.all([
      readFile(sidebarPath, 'utf8'),
      readFile(fileNodePath, 'utf8'),
    ]);
    const vaultSection = source.slice(source.indexOf('Connected vault section'), source.indexOf('onDragEnter={handleDragEnterTarget(IMPORT_ROOT_DROP_TARGET_ID)}'));

    expect(vaultSection).toContain('Obsidian Vault');
    expect(vaultSection).not.toContain('border-t');
    expect(vaultSection).toContain('className="mx-1 pl-2 pr-2 pt-3 pb-2.5"');
    expect(fileNode).toContain("paddingLeft: `${depth === 0 ? 8 : 2}px`");
  });

  it('hides expand chevrons for all folder rows without changing their click behavior', async () => {
    const [sidebar, fileNode] = await Promise.all([
      readFile(sidebarPath, 'utf8'),
      readFile(fileNodePath, 'utf8'),
    ]);

    expect(sidebar).not.toContain('showFolderChevron={!isVaultFolder(node.folder)}');
    expect(fileNode).toContain('showFolderChevron = false');
    expect(fileNode).toContain('isFolder && showFolderChevron && (');
  });

  it('keeps bottom sidebar sections and graph stats inside the available panel height', async () => {
    const [app, sidebar, rightPanel] = await Promise.all([
      readFile(appPath, 'utf8'),
      readFile(sidebarPath, 'utf8'),
      readFile(rightPanelPath, 'utf8'),
    ]);

    expect(app).toContain('className="flex-1 flex min-h-0 overflow-visible relative"');
    expect(app).toContain('className="flex-1 min-h-0 overflow-hidden"');
    expect(sidebar).toContain('className="w-full h-full min-h-0 flex flex-col');
    expect(sidebar).toContain('className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden');
    expect(rightPanel).toContain('className={`w-full h-full min-h-0 flex flex-col');
  });
});
