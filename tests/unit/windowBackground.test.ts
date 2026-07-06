import { describe, it, expect } from 'vitest';
import { resolveBackgroundColor } from '../../electron/windowBackground.cjs';

describe('resolveBackgroundColor', () => {
  it('accepts 6-digit hex colors', () => {
    expect(resolveBackgroundColor('#262624')).toBe('#262624');
    expect(resolveBackgroundColor('#EAE8E0')).toBe('#EAE8E0');
    expect(resolveBackgroundColor('#eae8e0')).toBe('#eae8e0');
  });

  it('rejects non-hex or malformed values', () => {
    expect(resolveBackgroundColor('red')).toBeNull();
    expect(resolveBackgroundColor('#fff')).toBeNull();
    expect(resolveBackgroundColor('#26262499')).toBeNull();
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
