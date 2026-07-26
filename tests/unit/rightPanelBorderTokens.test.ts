import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const backlinksPath = fileURLToPath(new URL('../../src/components/rightPanel/BacklinksPanel.tsx', import.meta.url));
const outgoingPath = fileURLToPath(new URL('../../src/components/rightPanel/OutgoingLinksPanel.tsx', import.meta.url));

describe('right-panel link card borders', () => {
  it('uses the shared divider token for resolved link cards', async () => {
    const [backlinks, outgoing] = await Promise.all([
      readFile(backlinksPath, 'utf8'),
      readFile(outgoingPath, 'utf8'),
    ]);

    for (const source of [backlinks, outgoing]) {
      expect(source).toContain("const cardBorder = 'var(--divider-subtle, #E6E2DA)';");
      expect(source).not.toContain("border-[rgba(249,249,247,0.25)]");
      expect(source).toContain('border rounded-md px-3 py-2.5');
    }
  });
});
