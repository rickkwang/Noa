import { describe, expect, it, vi } from 'vitest';
import { installSingleInstanceGuard } from '../../electron/singleInstance.cjs';

describe('installSingleInstanceGuard', () => {
  it('quits a secondary process before lifecycle bootstrap', () => {
    const quit = vi.fn();
    const app = {
      requestSingleInstanceLock: () => false,
      quit,
      on: vi.fn(),
      isReady: () => false,
    };

    expect(installSingleInstanceGuard({
      app,
      getWindow: () => null,
      createWindow: vi.fn(),
    })).toBe(false);
    expect(quit).toHaveBeenCalledOnce();
    expect(app.on).not.toHaveBeenCalled();
  });

  it('restores and focuses the primary window for a second launch', () => {
    let secondInstance: (() => void) | undefined;
    const win = {
      isDestroyed: () => false,
      isMinimized: () => true,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    };
    const createWindow = vi.fn();
    const app = {
      requestSingleInstanceLock: () => true,
      quit: vi.fn(),
      on: (event: string, listener: () => void) => {
        if (event === 'second-instance') secondInstance = listener;
      },
      isReady: () => true,
    };

    expect(installSingleInstanceGuard({ app, getWindow: () => win, createWindow })).toBe(true);
    secondInstance?.();

    expect(win.restore).toHaveBeenCalledOnce();
    expect(win.show).toHaveBeenCalledOnce();
    expect(win.focus).toHaveBeenCalledOnce();
    expect(createWindow).not.toHaveBeenCalled();
  });

  it('recreates the primary window when the app is ready but no window remains', () => {
    let secondInstance: (() => void) | undefined;
    const createWindow = vi.fn();
    const app = {
      requestSingleInstanceLock: () => true,
      quit: vi.fn(),
      on: (event: string, listener: () => void) => {
        if (event === 'second-instance') secondInstance = listener;
      },
      isReady: () => true,
    };

    installSingleInstanceGuard({ app, getWindow: () => null, createWindow });
    secondInstance?.();

    expect(createWindow).toHaveBeenCalledOnce();
  });
});
