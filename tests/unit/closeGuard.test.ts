import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { installCloseGuard } from '../../electron/closeGuard.cjs';

function setup() {
  const app = Object.assign(new EventEmitter(), { quit: vi.fn() });
  const win = Object.assign(new EventEmitter(), { close: vi.fn(), webContents: { send: vi.fn() } });
  const ipcMain = new EventEmitter();
  installCloseGuard({ app, win, ipcMain });
  ipcMain.emit('app:save-ready', { sender: win.webContents });
  return { app, win, ipcMain };
}

describe('desktop save before close', () => {
  it('allows closing before the renderer has mounted', () => {
    const app = new EventEmitter();
    const win = Object.assign(new EventEmitter(), { webContents: { send: vi.fn() } });
    installCloseGuard({ app, win, ipcMain: new EventEmitter() });
    const event = { preventDefault: vi.fn() };
    win.emit('close', event);
    app.emit('before-quit', event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('waits beyond the old 800ms grace period for a completed save', () => {
    vi.useFakeTimers();
    try {
      const { app, win, ipcMain } = setup();
      const event = { preventDefault: vi.fn() };
      app.emit('before-quit', event);
      vi.advanceTimersByTime(5000);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(win.webContents.send).toHaveBeenCalledWith('app:before-quit');
      expect(app.quit).not.toHaveBeenCalled();
      ipcMain.emit('app:save-complete', { sender: win.webContents }, true);
      expect(app.quit).toHaveBeenCalledOnce();
      const next = { preventDefault: vi.fn() };
      app.emit('before-quit', next);
      expect(next.preventDefault).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('keeps the window on failure, allows retry, and ignores other senders', () => {
    const { app, win, ipcMain } = setup();
    win.emit('close', { preventDefault: vi.fn() });
    ipcMain.emit('app:save-complete', { sender: {} }, true);
    expect(win.close).not.toHaveBeenCalled();
    ipcMain.emit('app:save-complete', { sender: win.webContents }, false);
    expect(win.close).not.toHaveBeenCalled();
    win.emit('close', { preventDefault: vi.fn() });
    expect(win.webContents.send).toHaveBeenCalledTimes(2);
    ipcMain.emit('app:save-complete', { sender: win.webContents }, true);
    expect(win.close).toHaveBeenCalledOnce();
    expect(app.quit).not.toHaveBeenCalled();
    win.emit('closed');
    expect(ipcMain.listenerCount('app:save-complete')).toBe(0);
    expect(app.listenerCount('before-quit')).toBe(0);
  });

  it('preload acknowledges only after the renderer promise settles', async () => {
    const ipcRenderer = Object.assign(new EventEmitter(), { send: vi.fn() });
    let bridge: any;
    vm.runInNewContext(readFileSync('electron/preload.cjs', 'utf8'), {
      require: () => ({ ipcRenderer, contextBridge: { exposeInMainWorld: (_name: string, value: unknown) => { bridge = value; } } }),
    });
    let finish!: () => void;
    const unsubscribe = bridge.lifecycle.onBeforeQuit(() => new Promise<void>(resolve => { finish = resolve; }));
    ipcRenderer.send.mockClear();
    ipcRenderer.emit('app:before-quit');
    expect(ipcRenderer.send).not.toHaveBeenCalled();
    finish();
    await new Promise(resolve => setImmediate(resolve));
    expect(ipcRenderer.send).toHaveBeenCalledWith('app:save-complete', true);
    unsubscribe();
    ipcRenderer.send.mockClear();
    bridge.lifecycle.onBeforeQuit(async () => { throw new Error('disk full'); });
    ipcRenderer.emit('app:before-quit');
    await new Promise(resolve => setImmediate(resolve));
    expect(ipcRenderer.send).toHaveBeenCalledWith('app:save-complete', false);
  });
});
