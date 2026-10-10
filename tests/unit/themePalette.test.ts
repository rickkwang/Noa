import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEME_SURFACES } from '../../src/lib/themePalette';

// theme-bootstrap.js runs before the bundle and can't import the palette, so it restates it.
describe('theme palette', () => {
  it('keeps the pre-paint bootstrap in sync with THEME_SURFACES', () => {
    const bootstrap = readFileSync('public/theme-bootstrap.js', 'utf8');
    for (const surfaces of [THEME_SURFACES.dark, THEME_SURFACES.light]) {
      expect(bootstrap).toContain(`setProperty('--bg-primary', '${surfaces.primary}')`);
      expect(bootstrap).toContain(`setProperty('--bg-secondary', '${surfaces.secondary}')`);
      expect(bootstrap).toContain(`backgroundColor = '${surfaces.primary}'`);
    }
  });
});
