import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const indexCssPath = fileURLToPath(new URL('../../src/index.css', import.meta.url));
const fileNodePath = fileURLToPath(new URL('../../src/components/sidebar/FileNode.tsx', import.meta.url));
const sidebarPath = fileURLToPath(new URL('../../src/components/Sidebar.tsx', import.meta.url));

describe('sidebar typography tokens', () => {
  it('puts default tree labels and icons just under the full text colour', async () => {
    const [css, fileNode, sidebar] = await Promise.all([
      readFile(indexCssPath, 'utf8'),
      readFile(fileNodePath, 'utf8'),
      readFile(sidebarPath, 'utf8'),
    ]);

    expect(css).toMatch(/\.noa-sidebar-tree-item\s*\{[^}]*color:\s*color-mix\(in srgb, var\(--text-primary, #2D2D2B\) 90%, transparent\)/);
    expect(fileNode).toContain('noa-sidebar-tree-item');
    expect(fileNode).not.toContain("isFolder ? 'text-[#CC7D5E]'");
    expect(sidebar).not.toContain('iconColor="#CC7D5E"');
  });
});
