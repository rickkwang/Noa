import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesPath = fileURLToPath(new URL('../../src/index.css', import.meta.url));
const propertiesPanelPath = fileURLToPath(new URL('../../src/components/rightPanel/PropertiesPanel.tsx', import.meta.url));

describe('Tag Explorer border tokens', () => {
  it('uses the shared divider token for tag pill borders in both themes', async () => {
    const [styles, propertiesPanel] = await Promise.all([
      readFile(stylesPath, 'utf8'),
      readFile(propertiesPanelPath, 'utf8'),
    ]);

    expect(styles).toContain('border: 1px solid var(--divider-subtle, #E6E2DA);');
    expect(styles).toContain('border-color: var(--divider-subtle, rgba(249,249,247,0.15));');
    expect(propertiesPanel).toContain("style={{ borderColor: 'var(--divider-subtle, #E6E2DA)' }}");
  });
});
