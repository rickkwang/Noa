import { describe, expect, it } from 'vitest';
import {
  SYSTEM_DEFAULT_FONT,
  SYSTEM_FONT_STACK,
  isSafeFontFamilyName,
  resolveFontFamily,
} from '../../src/lib/fontFamily';

describe('resolveFontFamily', () => {
  it('resolves the system default to CSS generic keywords, never a family name', () => {
    const resolved = resolveFontFamily(SYSTEM_DEFAULT_FONT);

    expect(resolved).toBe(SYSTEM_FONT_STACK);
    // Browsers won't match the platform UI face by name; a name would silently fall back.
    expect(resolved).toContain('-apple-system');
    expect(resolved).toContain('system-ui');
    expect(resolved).not.toContain('AppleSystemUIFont');
  });

  it('quotes a chosen family and keeps the system stack as a fallback', () => {
    expect(resolveFontFamily('Helvetica Neue')).toBe(`"Helvetica Neue", ${SYSTEM_FONT_STACK}`);
  });

  it('supports CJK family names', () => {
    expect(isSafeFontFamilyName('苹方-简')).toBe(true);
    expect(resolveFontFamily('苹方-简')).toBe(`"苹方-简", ${SYSTEM_FONT_STACK}`);
  });

  it('falls back to the system stack for an empty or missing value', () => {
    expect(resolveFontFamily('')).toBe(SYSTEM_FONT_STACK);
  });

  it('refuses names that could break out of the CSS declaration', () => {
    // ThemeInjector interpolates this into a <style> element, so CSS syntax must not survive.
    for (const hostile of [
      'Arial"; } body { display: none } .x {',
      'Arial; color: red',
      'Arial<script>',
      'Arial\\',
      'Arial{}',
    ]) {
      expect(isSafeFontFamilyName(hostile)).toBe(false);
      expect(resolveFontFamily(hostile)).toBe(SYSTEM_FONT_STACK);
    }
  });

  it('rejects absurdly long names rather than emitting them', () => {
    expect(isSafeFontFamilyName('A'.repeat(200))).toBe(false);
  });
});
