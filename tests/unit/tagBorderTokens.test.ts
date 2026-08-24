import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesPath = fileURLToPath(new URL('../../src/index.css', import.meta.url));
const propertiesPanelPath = fileURLToPath(new URL('../../src/components/rightPanel/PropertiesPanel.tsx', import.meta.url));

describe('tag border tokens', () => {
  it('keeps explorer borders tokenized and renders property tags as rounded metadata chips', async () => {
    const [styles, propertiesPanel] = await Promise.all([
      readFile(stylesPath, 'utf8'),
      readFile(propertiesPanelPath, 'utf8'),
    ]);

    expect(styles).toContain('border: 1px solid var(--divider-subtle, #E6E2DA);');
    expect(styles).toContain('border-color: var(--divider-subtle, rgba(249,249,247,0.15));');
    expect(propertiesPanel).toContain('rounded-[5px] border border-[#CC7D5E]/20 bg-[#CC7D5E]/[0.08] px-2 py-1 text-[10px] font-redaction font-medium text-[#CC7D5E] leading-none');
  });
});
