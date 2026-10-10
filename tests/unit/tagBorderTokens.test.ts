import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesPath = fileURLToPath(new URL('../../src/index.css', import.meta.url));

describe('tag border tokens', () => {
  it('keeps explorer borders tokenized', async () => {
    const styles = await readFile(stylesPath, 'utf8');

    expect(styles).toContain('border: 1px solid var(--divider-subtle, #E6E2DA);');
    expect(styles).toContain('border-color: var(--divider-subtle, rgba(249,249,247,0.15));');
  });
});
