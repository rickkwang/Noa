import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sidebarPath = fileURLToPath(new URL('../../src/components/Sidebar.tsx', import.meta.url));
const fileNodePath = fileURLToPath(new URL('../../src/components/sidebar/FileNode.tsx', import.meta.url));
const appPath = fileURLToPath(new URL('../../src/App.tsx', import.meta.url));
const rightPanelPath = fileURLToPath(new URL('../../src/components/RightPanel.tsx', import.meta.url));
const indexCssPath = fileURLToPath(new URL('../../src/index.css', import.meta.url));

describe('sidebar search result layout', () => {
  it('keeps sidebar scroll chrome without changing compact 6px search result spacing', async () => {
    const [source, styles] = await Promise.all([
      readFile(sidebarPath, 'utf8'),
      readFile(indexCssPath, 'utf8'),
    ]);

    expect(source).toContain('className="noa-sidebar-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden"');
    expect(source).not.toContain('[scrollbar-gutter:stable]');
    expect(source).toContain('p-2 mx-1.5 mb-1.5 rounded-md cursor-pointer border-l-2');
    expect(styles).not.toContain('scrollbar-width: none;');
    expect(styles).not.toContain('.noa-sidebar-scroll::-webkit-scrollbar');
  });

  it('uses a short sidebar-surface fade instead of a hard toolbar-content boundary', async () => {
    const [source, styles] = await Promise.all([
      readFile(sidebarPath, 'utf8'),
      readFile(indexCssPath, 'utf8'),
    ]);

    expect(source).toContain('className="noa-sidebar-toolbar-mask h-8 flex items-center px-2 gap-0.5 shrink-0 z-10 overflow-visible"');
    expect(source).not.toContain('className="h-8 border-b flex items-center px-2 gap-0.5 shrink-0 z-10 overflow-hidden"');
    expect(source).not.toContain('shrink-0 bg-[#EFEAE3] z-10 overflow-hidden');
    expect(source).not.toContain("borderBottomColor: 'var(--panel-divider, #2D2D2B)'");
    expect(styles).toContain('.noa-sidebar-toolbar-mask::after {');
    expect(styles).toContain('height: 10px;');
    expect(styles).toContain('background: linear-gradient(to bottom, var(--bg-sidebar, #F4F4F2) 0%, transparent 100%);');
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

  it('does not retain a right-edge scrollbar-gutter compensation on file rows', async () => {
    const fileNode = await readFile(fileNodePath, 'utf8');

    expect(fileNode).not.toContain('stable 6px scrollbar gutter');
    expect(fileNode).not.toContain("marginRight: '-1px'");
  });

  it('uses a subtle semantic branch line and gives folders a distinct local text weight', async () => {
    const fileNode = await readFile(fileNodePath, 'utf8');

    expect(fileNode).toContain('border-l border-[var(--divider-subtle)]');
    expect(fileNode).not.toContain('border-l border-[#2D2D2B]/15');
    expect(fileNode).toContain("isActive ? 'font-bold' : isFolder ? 'font-[425]' : ''");
    expect(fileNode).not.toContain("isFolder ? 'font-medium' : ''");
  });

  it('marks multi-selected rows without shifting their icon column', async () => {
    const fileNode = await readFile(fileNodePath, 'utf8');

    expect(fileNode).toContain("'bg-[#CC7D5E]/20 shadow-[inset_2px_0_0_#CC7D5E]'");
    expect(fileNode).not.toContain("'bg-[#CC7D5E]/20 border-l-2 border-[#CC7D5E]'");
  });

  it('keeps a one-pixel breath between adjacent tree-row highlights', async () => {
    const fileNode = await readFile(fileNodePath, 'utf8');

    expect(fileNode).toContain('<div className="font-redaction mb-px">');
  });

  it('anchors each branch line to its folder icon center at every depth', async () => {
    const fileNode = await readFile(fileNodePath, 'utf8');

    expect(fileNode).toContain("marginLeft: depth === 0 ? '19px' : '13px'");
    expect(fileNode).not.toContain("marginLeft: '18px'");
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
    // Matched unanchored from the quote: what this guards is the height chain
    // (h-full + min-h-0 + flex-col) that keeps the bottom sections on screen,
    // not the class list's leading position. Surface classes like
    // noa-sidebar-surface legitimately sit in front of it.
    expect(sidebar).toMatch(/className="[^"]*\bw-full h-full min-h-0 flex flex-col/);
    expect(sidebar).toContain('className="noa-sidebar-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden');
    expect(rightPanel).toContain('className={`w-full h-full min-h-0 flex flex-col');
  });
});
