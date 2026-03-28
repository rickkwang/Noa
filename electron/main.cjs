const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;
const DEV_URL = 'http://127.0.0.1:3000';

let win;
let updateState = { state: 'idle', message: '' };

function emitUpdateStatus(payload) {
  updateState = payload;
  if (win && !win.isDestroyed()) {
    win.webContents.send('app-updater:status', payload);
  }
}

function buildMenu() {
  const template = [
    {
      label: 'Noa',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Check for Updates',
          click: () => {
            void autoUpdater.checkForUpdates();
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.channel = process.env.NOA_UPDATE_CHANNEL || 'beta';
  autoUpdater.allowPrerelease = autoUpdater.channel === 'beta';

  autoUpdater.on('checking-for-update', () => {
    emitUpdateStatus({ state: 'checking', message: 'Checking for updates...' });
  });

  autoUpdater.on('update-available', (info) => {
    emitUpdateStatus({
      state: 'available',
      version: info.version,
      message: `Update ${info.version} available. Downloading...`,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    emitUpdateStatus({
      state: 'downloading',
      message: `Downloading ${Math.round(progress.percent)}%`,
      progress: progress.percent,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    emitUpdateStatus({
      state: 'downloaded',
      version: info.version,
      message: `Update ${info.version} downloaded. Ready to restart.`,
    });
  });

  autoUpdater.on('update-not-available', () => {
    emitUpdateStatus({ state: 'idle', message: 'No update available.' });
  });

  autoUpdater.on('error', (error) => {
    emitUpdateStatus({
      state: 'error',
      message: error?.message || 'Update check failed.',
    });
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: 'Noa',
    backgroundColor: '#EAE8E0',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (isDev) {
    void win.loadURL(DEV_URL);
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  buildMenu();
  setupAutoUpdater();
  createWindow();

  ipcMain.handle('app-info:get-version', () => app.getVersion());
  ipcMain.handle('app-updater:get-status', () => updateState);
  ipcMain.handle('app-updater:check', async () => {
    await autoUpdater.checkForUpdates();
    return true;
  });
  ipcMain.handle('app-updater:quit-and-install', () => {
    autoUpdater.quitAndInstall();
    return true;
  });

  if (!isDev) {
    setTimeout(() => {
      void autoUpdater.checkForUpdates();
    }, 10_000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
