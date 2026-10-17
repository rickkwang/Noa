import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sidebarPath = fileURLToPath(new URL('../../src/components/Sidebar.tsx', import.meta.url));
const fileNodePath = fileURLToPath(new URL('../../src/components/sidebar/FileNode.tsx', import.meta.url));
const appPath = fileURLToPath(new URL('../../src/App.tsx', import.meta.url));
const rightPanelPath = fileURLToPath(new URL('../../src/components/RightPanel.tsx', import.meta.url));
const indexCssPath = fileURLToPath(new URL('../../src/index.css', import.meta.url));

describe('sidebar search result layout', () => {
  it('keeps sidebar scroll chrome and the search hit row markup', async () => {
    const [source, styles] = await Promise.all([
      readFile(sidebarPath, 'utf8'),
      readFile(indexCssPath, 'utf8'),
    ]);

    expect(source).toContain('className="noa-sidebar-scroll noa-sidebar-scroll-fade group/tree flex-1 min-h-0 overflow-y-auto overflow-x-hidden"');
    expect(source).not.toContain('[scrollbar-gutter:stable]');
    expect(source).toContain('noa-search-hit mx-2 rounded-lg px-3 py-2 cursor-pointer font-ui');
    expect(styles).not.toContain('scrollbar-width: none;');
    expect(styles).not.toContain('.noa-sidebar-scroll::-webkit-scrollbar');
  });

  it('fades the toolbar-content boundary only once the tree has scrolled under it', async () => {
    const [source, styles] = await Promise.all([
      readFile(sidebarPath, 'utf8'),
      readFile(indexCssPath, 'utf8'),
    ]);

    expect(source).toContain('className="noa-sidebar-toolbar-mask h-8 flex items-center pl-[10px] pr-2 gap-0.5 shrink-0 z-10 overflow-visible"');
    expect(source).not.toContain('className="h-8 border-b flex items-center px-2 gap-0.5 shrink-0 z-10 overflow-hidden"');
    expect(source).not.toContain('shrink-0 bg-[#EFEAE3] z-10 overflow-hidden');
    expect(source).not.toContain("borderBottomColor: 'var(--panel-divider, #2D2D2B)'");
    expect(styles).toContain('.noa-sidebar-toolbar-mask::after {');
    // Fade must stop short of the scrollbar gutter, and that inset must match ::-webkit-scrollbar.
    const toolbarFade = styles.slice(
      styles.indexOf('.noa-sidebar-toolbar-mask::after {'),
      styles.indexOf('}', styles.indexOf('.noa-sidebar-toolbar-mask::after {')),
    );
    expect(toolbarFade).toContain('right: 6px;');
    // Strength is the tree's own scroll timeline (CSS, no script), so an unscrolled tree keeps the seam hidden.
    expect(toolbarFade).toContain('height: 28px;');
    expect(toolbarFade).toContain('bottom: -28px;');
    expect(toolbarFade).toContain('opacity: var(--noa-fade-top, 0);');
    expect(toolbarFade).toContain('animation-timeline: --noa-sidebar-tree;');
    expect(styles).not.toContain('background: linear-gradient(to bottom, var(--bg-sidebar, #F4F4F2) 0%, transparent 100%);');
    expect(source).toContain('noa-sidebar-fade-scope');
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
    const vaultSection = source.slice(source.indexOf('Connected vault section'), source.indexOf('onDragEnter={markVaultRootTarget}'));

    expect(vaultSection).toContain('Obsidian Vault');
    expect(vaultSection).not.toContain('border-t');
    expect(vaultSection).toContain('className={`mx-2 pl-2 pr-2 pb-3 ${');
    expect(fileNode).toContain("paddingLeft: `${depth === 0 ? 7 : 3.5}px`");
  });

  it('keeps the sidebar scrollbar gutter, its pull-back, and the row margin all at 6px', async () => {
    const [styles, fileNode] = await Promise.all([
      readFile(indexCssPath, 'utf8'),
      readFile(fileNodePath, 'utf8'),
    ]);

    // Gutter, pull-back, and row margin must all be 6px; a larger pull-back clips the right corner radius.
    expect(styles).toContain('.noa-sidebar-scroll {\n  scrollbar-gutter: stable;\n}');
    expect(styles).toContain('.noa-sidebar-scroll > * {\n  margin-right: -6px;\n}');
    expect(styles).toContain('::-webkit-scrollbar {\n  width: 6px;');
    expect(fileNode).toContain("py-0 px-2 ${depth === 0 ? 'mx-2' : 'mr-2'} rounded-lg");
  });

  it('does not retain a right-edge scrollbar-gutter compensation on file rows', async () => {
    const fileNode = await readFile(fileNodePath, 'utf8');

    expect(fileNode).not.toContain('stable 6px scrollbar gutter');
    expect(fileNode).not.toContain("marginRight: '-1px'");
  });

  it('uses a subtle semantic branch line and one resting text weight for folders and notes', async () => {
    const fileNode = await readFile(fileNodePath, 'utf8');

    expect(fileNode).toContain('border-l-[0.5px] border-transparent');
    expect(fileNode).toContain('group-hover/tree:border-[var(--divider-subtle)]');
    expect(fileNode).not.toContain('border-l border-[#2D2D2B]/15');
    // 425 vs 400 is not visibly different; rows keep one resting weight and active is marked by background alone.
    expect(fileNode).not.toContain("font-bold");
    expect(fileNode).not.toContain("font-[425]");
    expect(fileNode).not.toContain("isFolder ? 'font-medium' : ''");
  });

  it('marks multi-selected rows without shifting their icon column', async () => {
    const fileNode = await readFile(fileNodePath, 'utf8');

    expect(fileNode).toContain("? 'noa-ink-selected'");
    expect(fileNode).not.toContain("'bg-[#CC7D5E]/20 border-l-2 border-[#CC7D5E]'");
  });

  it('keeps a one-pixel breath between adjacent tree-row highlights', async () => {
    const fileNode = await readFile(fileNodePath, 'utf8');

    expect(fileNode).toMatch(/className={?[`"]font-ui mb-px\b/);
  });

  it('anchors each branch line to its folder icon center at every depth', async () => {
    const fileNode = await readFile(fileNodePath, 'utf8');

    expect(fileNode).toContain("marginLeft: depth === 0 ? '21.5px' : '10px'");
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
    // Guards the height chain (h-full + min-h-0 + flex-col), not the class list's leading position.
    expect(sidebar).toMatch(/className="[^"]*\bw-full h-full min-h-0 flex flex-col/);
    expect(sidebar).toContain('className="noa-sidebar-scroll noa-sidebar-scroll-fade flex-1 min-h-0 overflow-y-auto overflow-x-hidden');
    expect(rightPanel).toContain('className={`w-full h-full min-h-0 flex flex-col');
  });
});
