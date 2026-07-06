const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('noaDesktop', {
  appInfo: {
    getVersion: () => ipcRenderer.invoke('app-info:get-version'),
  },
  appUpdater: {
    checkForUpdates: () => ipcRenderer.invoke('app-updater:check'),
    quitAndInstall: () => ipcRenderer.invoke('app-updater:quit-and-install'),
    openDownloadUrl: (url) => ipcRenderer.invoke('app-updater:open-download-url', url),
    getStatus: () => ipcRenderer.invoke('app-updater:get-status'),
    onStatusChange: (listener) => {
      const handler = (_event, status) => listener(status);
      ipcRenderer.on('app-updater:status', handler);
      return () => ipcRenderer.removeListener('app-updater:status', handler);
    },
  },
  appearance: {
    setWindowBackgroundColor: (color) => ipcRenderer.invoke('window:set-background-color', color),
  },
  lifecycle: {
    onBeforeQuit: (listener) => {
      const handler = () => listener();
      ipcRenderer.on('app:before-quit', handler);
      return () => ipcRenderer.removeListener('app:before-quit', handler);
    },
  },
});
