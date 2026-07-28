import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesPath = fileURLToPath(new URL('../../src/index.css', import.meta.url));

describe('shadow tokens', () => {
  it('defines both tokens in light mode and redefines them in dark mode', async () => {
    const styles = await readFile(stylesPath, 'utf8');
    expect(styles).toContain('--shadow-elevated: 0 1px 2px 0 rgba(45,45,43,0.05)');
    expect(styles).toContain('--shadow-floating: 0 4px 12px 0 rgba(45,45,43,0.12)');
    expect(styles).toContain('--shadow-elevated: 0 1px 2px 0 rgba(0,0,0,0.24)');
    expect(styles).toContain('--shadow-floating: 0 4px 12px 0 rgba(0,0,0,0.45)');
  });

  it('utility classes consume the tokens rather than raw shadow values', async () => {
    const styles = await readFile(stylesPath, 'utf8');
    expect(styles).toContain('box-shadow: var(--shadow-elevated);');
    expect(styles).toContain('box-shadow: var(--shadow-floating);');
  });

  it('has no dangling dark-mode override for the removed hard-offset dropdown shadow', async () => {
    const styles = await readFile(stylesPath, 'utf8');
    expect(styles).not.toContain('shadow-\\[4px_4px_0_0');
  });
});
