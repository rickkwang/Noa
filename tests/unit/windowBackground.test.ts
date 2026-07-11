import { describe, it, expect } from 'vitest';
import { resolveBackgroundColor } from '../../electron/windowBackground.cjs';

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
