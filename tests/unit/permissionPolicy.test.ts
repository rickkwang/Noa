import { describe, expect, it } from 'vitest';
import { isPermissionAllowed } from '../../electron/permissionPolicy.cjs';

describe('isPermissionAllowed', () => {
  it('grants file system access so restored vault handles survive relaunch', () => {
    expect(isPermissionAllowed('fileSystem')).toBe(true);
  });

  it('grants clipboard write for the copy-code button', () => {
    expect(isPermissionAllowed('clipboard-sanitized-write')).toBe(true);
  });

  it('denies capabilities the renderer never uses', () => {
    for (const permission of [
      'media',
      'geolocation',
      'notifications',
      'midi',
      'midiSysex',
      'hid',
      'serial',
      'usb',
      'display-capture',
      'idle-detection',
      'window-management',
      'openExternal',
      'clipboard-read',
      'pointerLock',
      'unknown',
    ]) {
      expect(isPermissionAllowed(permission)).toBe(false);
    }
  });
});
