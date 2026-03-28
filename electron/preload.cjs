const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('noaDesktop', {
  appInfo: {
    getVersion: () => ipcRenderer.invoke('app-info:get-version'),
  },
  appUpdater: {
    checkForUpdates: () => ipcRenderer.invoke('app-updater:check'),
    quitAndInstall: () => ipcRenderer.invoke('app-updater:quit-and-install'),
    getStatus: () => ipcRenderer.invoke('app-updater:get-status'),
    onStatusChange: (listener) => {
      const handler = (_event, status) => listener(status);
      ipcRenderer.on('app-updater:status', handler);
      return () => ipcRenderer.removeListener('app-updater:status', handler);
    },
  },
  lifecycle: {
    onBeforeQuit: (listener) => {
      const handler = () => listener();
      ipcRenderer.on('app:before-quit', handler);
      return () => ipcRenderer.removeListener('app:before-quit', handler);
    },
  },
});
