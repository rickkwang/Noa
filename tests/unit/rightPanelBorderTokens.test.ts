import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const backlinksPath = fileURLToPath(new URL('../../src/components/rightPanel/BacklinksPanel.tsx', import.meta.url));
const outgoingPath = fileURLToPath(new URL('../../src/components/rightPanel/OutgoingLinksPanel.tsx', import.meta.url));
const linkListPath = fileURLToPath(new URL('../../src/components/rightPanel/LinkList.tsx', import.meta.url));

describe('right-panel link rows', () => {
  it('draws no per-row chrome and hardcodes no dark-mode hairline', async () => {
    const sources = await Promise.all([
      readFile(backlinksPath, 'utf8'),
      readFile(outgoingPath, 'utf8'),
      readFile(linkListPath, 'utf8'),
    ]);

    for (const source of sources) {
      // The dark card border was once spelled out as a literal instead of
      // taking the shared token; rows carry no border at all now, so neither
      // spelling belongs here.
      expect(source).not.toContain('border-[rgba(249,249,247,0.25)]');
      expect(source).not.toMatch(/\bborder(-dashed)?\b(?!-)/);
    }
  });

  it('keeps both panels on the shared row so they cannot drift apart', async () => {
    const [backlinks, outgoing] = await Promise.all([
      readFile(backlinksPath, 'utf8'),
      readFile(outgoingPath, 'utf8'),
    ]);

    for (const source of [backlinks, outgoing]) {
      expect(source).toContain("from './LinkList'");
      expect(source).toContain('<LinkRow');
      expect(source).toContain('<LinkSectionHeader');
    }
  });
});
