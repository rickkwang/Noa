import { describe, it, expect } from 'vitest';
import { resolveBackgroundColor, resolveSidebarWindowAppearance } from '../../electron/windowBackground.cjs';

describe('resolveBackgroundColor', () => {
  it('accepts 6-digit hex colors', () => {
    expect(resolveBackgroundColor('#2D2D2B')).toBe('#2D2D2B');
    expect(resolveBackgroundColor('#F9F9F7')).toBe('#F9F9F7');
    expect(resolveBackgroundColor('#f9f9f7')).toBe('#f9f9f7');
  });

  it('rejects non-hex or malformed values', () => {
    expect(resolveBackgroundColor('red')).toBeNull();
    expect(resolveBackgroundColor('#fff')).toBeNull();
    expect(resolveBackgroundColor('#2D2D2B99')).toBeNull();
    expect(resolveBackgroundColor('rgba(0,0,0,0)')).toBeNull();
    expect(resolveBackgroundColor('#2626ZZ')).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(resolveBackgroundColor(undefined)).toBeNull();
    expect(resolveBackgroundColor(null)).toBeNull();
    expect(resolveBackgroundColor(0x262624)).toBeNull();
    expect(resolveBackgroundColor({})).toBeNull();
  });
});

describe('resolveSidebarWindowAppearance', () => {
  it('uses a clear native backing and sidebar vibrancy on macOS when enabled', () => {
    expect(resolveSidebarWindowAppearance(true, '#2D2D2B', true)).toEqual({
      backgroundColor: '#00000000',
      vibrancy: 'sidebar',
    });
  });

  it('restores the opaque theme backing when disabled', () => {
    expect(resolveSidebarWindowAppearance(false, '#F9F9F7', true)).toEqual({
      backgroundColor: '#F9F9F7',
      vibrancy: null,
    });
  });

  it('keeps a safe opaque fallback on platforms without vibrancy', () => {
    expect(resolveSidebarWindowAppearance(true, '#2D2D2B', false)).toEqual({
      backgroundColor: '#2D2D2B',
      vibrancy: null,
    });
  });

  it.each([
    ['yes', '#2D2D2B'],
    [true, '#fff'],
    [false, '#00000000'],
  ])('rejects unsafe input: %j, %j', (enabled, color) => {
    expect(resolveSidebarWindowAppearance(enabled, color, true)).toBeNull();
  });
});
