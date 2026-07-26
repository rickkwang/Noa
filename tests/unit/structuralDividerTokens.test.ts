import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const themeInjectorPath = fileURLToPath(new URL('../../src/components/ThemeInjector.tsx', import.meta.url));
const globalStylesPath = fileURLToPath(new URL('../../src/index.css', import.meta.url));
const previewPanePath = fileURLToPath(new URL('../../src/components/editor/PreviewPane.tsx', import.meta.url));

describe('structural divider tokens', () => {
  it('uses the divider token for normal borders in both themes', async () => {
    const [themeInjector, globalStyles, previewPane] = await Promise.all([
      readFile(themeInjectorPath, 'utf8'),
      readFile(globalStylesPath, 'utf8'),
      readFile(previewPanePath, 'utf8'),
    ]);

    expect(themeInjector).toContain("root.style.setProperty('--border-default', 'var(--divider-subtle)');");
    expect(globalStyles).toContain('.border-\\[\\#2D2D2B\\]      { border-color: var(--border-default) !important; }');
    expect(themeInjector).toContain('.border-\\\\[\\\\#2D2D2B\\\\]\\\\/15 { border-color: var(--divider-subtle) !important; }');
    expect(previewPane).not.toContain("isDark ? 'rgba(249,249,247,0.5)' : 'var(--divider-subtle, #E6E2DA)'");
  });
});
