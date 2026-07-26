import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sidebarPath = fileURLToPath(new URL('../../src/components/Sidebar.tsx', import.meta.url));

describe('sidebar search result layout', () => {
  it('insets search result rows to balance the reserved scrollbar gutter', async () => {
    const source = await readFile(sidebarPath, 'utf8');

    expect(source).not.toContain('className="-mr-[5px]"');
    expect(source).toContain('p-2 ml-1 mb-1.5 rounded-md cursor-pointer border-l-2');
  });
});
