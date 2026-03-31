const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

const isDev = !app.isPackaged;
let win;
let updateState = { state: 'idle', message: '' };

function emitUpdateStatus(payload) {
  updateState = payload;
  if (win && !win.isDestroyed()) {
    win.webContents.send('app-updater:status', payload);
  }
}

function getReleasePageUrl(version) {
  if (!version) return 'https://github.com/rickkwang/Noa/releases';
  return `https://github.com/rickkwang/Noa/releases/tag/v${version}`;
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  // Allow adhoc/unsigned builds to attempt update flow
  autoUpdater.forceDevUpdateConfig = false;

  autoUpdater.on('checking-for-update', () => {
    emitUpdateStatus({ state: 'checking', message: 'Checking for updates...' });
  });

  autoUpdater.on('update-available', (info) => {
    emitUpdateStatus({
      state: 'available',
      version: info.version,
      message: `New version available: v${info.version}. Click "Download Update".`,
    });
  });

  autoUpdater.on('update-not-available', () => {
    emitUpdateStatus({ state: 'idle', message: `You're up to date (v${app.getVersion()}).` });
  });

  autoUpdater.on('download-progress', (progress) => {
    emitUpdateStatus({
      state: 'downloading',
      progress: Math.round(progress.percent),
      message: `Downloading... ${Math.round(progress.percent)}%`,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    emitUpdateStatus({
      state: 'ready',
      version: info.version,
      message: `v${info.version} ready to install. Restart to apply.`,
    });
  });

  autoUpdater.on('error', (err) => {
    const isFeedOrVersionIssue =
      err.message?.includes('ERR_UPDATER_INVALID_RELEASE_FEED') ||
      err.message?.includes('No published versions');

    const isLikelyMacSigningIssue =
      process.platform === 'darwin' &&
      (
        err.message?.includes('code signature') ||
        err.message?.includes('signed') ||
        err.message?.includes('download') ||
        err.message?.includes('verify') ||
        err.message?.includes('ENOENT')
      );

    console.error('[updater] error', err);

    emitUpdateStatus({
      state: 'error',
      message: isFeedOrVersionIssue
        ? 'Update feed is not ready yet. Please retry in a moment.'
        : isLikelyMacSigningIssue
          ? 'Automatic update is unavailable on this macOS build. Open the release page to download the update manually.'
          : 'Could not complete in-app update. Please retry.',
      downloadUrl: isLikelyMacSigningIssue ? getReleasePageUrl(updateState.version) : updateState.downloadUrl,
    });
  });
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
          click: () => { void doCheckForUpdates(); },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: 'Noa',
    backgroundColor: '#EAE8E0',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 16 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (isDev) {
    void win.loadURL('http://127.0.0.1:3000');
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

async function doCheckForUpdates() {
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    emitUpdateStatus({ state: 'error', message: 'Could not check for updates. Please check your connection.' });
  }
}

app.whenReady().then(() => {
  setupAutoUpdater();
  buildMenu();
  createWindow();

  ipcMain.handle('app-info:get-version', () => app.getVersion());
  ipcMain.handle('app-updater:get-status', () => updateState);
  ipcMain.handle('app-updater:check', async () => {
    await doCheckForUpdates();
    return true;
  });
  ipcMain.handle('app-updater:quit-and-install', () => {
    if (updateState.state === 'ready') {
      // Downloaded successfully — quit and install
      autoUpdater.quitAndInstall(false, true);
    } else if (updateState.state === 'available') {
      emitUpdateStatus({
        state: 'downloading',
        version: updateState.version,
        message: `Downloading v${updateState.version ?? ''}...`,
      });
      autoUpdater.downloadUpdate().catch(() => {
        console.error('[updater] download failed');
        emitUpdateStatus({
          state: 'error',
          version: updateState.version,
          downloadUrl: getReleasePageUrl(updateState.version),
          message: process.platform === 'darwin'
            ? 'Automatic download failed on this macOS build. Open the release page to download the update manually.'
            : 'Download failed. Please retry.',
        });
      });
    } else {
      emitUpdateStatus({
        state: 'error',
        message: 'No update is ready to install.',
      });
    }
    return true;
  });

  ipcMain.handle('app-updater:open-download-url', async (_event, url) => {
    if (!url) return false;
    await shell.openExternal(url);
    return true;
  });

  if (!isDev) {
    setTimeout(() => { void doCheckForUpdates(); }, 10_000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let isQuitting = false;
app.on('before-quit', (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { app.quit(); return; }
  win.webContents.send('app:before-quit');
  setTimeout(() => app.quit(), 800);
});
