const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { getReleasePageUrl, installMacUpdate } = require('./macUpdateInstaller.cjs');

const isDev = !app.isPackaged;
const isMac = process.platform === 'darwin';

let win;
let updateState = { state: 'idle', message: '' };
let latestAvailableVersion = null;
let latestAvailableInfo = null;
let macInstallTask = null;
let downloadTask = null;

function emitUpdateStatus(payload) {
  updateState = payload;
  if (win && !win.isDestroyed()) {
    win.webContents.send('app-updater:status', payload);
  }
}

function classifyUpdaterIssue(message, fallbackReason = 'update-error') {
  const text = String(message || '').toLowerCase();
  if (text.includes('invalid release feed') || text.includes('no published versions')) {
    return 'feed-not-ready';
  }
  if (text.includes('network') || text.includes('timed out') || text.includes('econnreset') || text.includes('enotfound')) {
    return 'network-error';
  }
  if (isMac && (text.includes('signed') || text.includes('verify') || text.includes('code signature') || text.includes('enoent'))) {
    return 'mac-update-unavailable';
  }
  return fallbackReason;
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.forceDevUpdateConfig = false;

  autoUpdater.on('checking-for-update', () => {
    emitUpdateStatus({ state: 'checking', message: 'Checking for updates...' });
  });

  autoUpdater.on('update-available', (info) => {
    latestAvailableVersion = info?.version || latestAvailableVersion;
    latestAvailableInfo = info || null;
    emitUpdateStatus({
      state: 'available',
      version: info.version,
      message: `New version available: v${info.version}. Click "Download Update".`,
    });
  });

  autoUpdater.on('update-not-available', () => {
    latestAvailableVersion = null;
    latestAvailableInfo = null;
    emitUpdateStatus({ state: 'idle', message: `You're up to date (v${app.getVersion()}).` });
  });

  autoUpdater.on('download-progress', (progress) => {
    emitUpdateStatus({
      state: 'downloading',
      progress: Math.round(progress.percent || 0),
      message: `Downloading... ${Math.round(progress.percent || 0)}%`,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    emitUpdateStatus({
      state: 'ready',
      version: info.version,
      progress: 100,
      message: `v${info.version} ready to install. Restart to apply.`,
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] error', err);
    const reason = classifyUpdaterIssue(err?.message, 'update-error');

    emitUpdateStatus({
      state: 'error',
      reason,
      message:
        reason === 'feed-not-ready'
          ? 'Update feed is not ready yet. Please retry in a moment.'
          : reason === 'mac-update-unavailable'
            ? 'Automatic update could not complete on this macOS build. Please retry the download.'
            : 'Could not complete in-app update. Please retry.',
      downloadUrl: reason === 'mac-update-unavailable' ? getReleasePageUrl(updateState.version) : updateState.downloadUrl,
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
  } catch (error) {
    console.error('[updater] check failed', error);
    emitUpdateStatus({
      state: 'error',
      reason: classifyUpdaterIssue(error?.message, 'check-failed'),
      message: 'Could not check for updates. Please check your connection and retry.',
    });
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
  ipcMain.handle('app-updater:quit-and-install', async () => {
    if (isDev) {
      return { ok: false, reason: 'dev-mode' };
    }

    if (isMac) {
      if (macInstallTask) {
        return { ok: true, reason: 'in-progress' };
      }

      const targetVersion = latestAvailableVersion || updateState.version || app.getVersion();
      const installInfo = latestAvailableInfo || { version: targetVersion };

      emitUpdateStatus({
        state: 'downloading',
        version: targetVersion,
        message: `Downloading v${targetVersion}...`,
      });

      macInstallTask = installMacUpdate({
        app,
        updateInfo: installInfo,
        onProgress: (percent) => {
          emitUpdateStatus({
            state: 'downloading',
            version: targetVersion,
            progress: percent,
            message: `Downloading... ${percent}%`,
          });
        },
      }).finally(() => {
        macInstallTask = null;
      });

      try {
        const result = await macInstallTask;
        emitUpdateStatus({
          state: 'downloaded',
          version: result.version,
          progress: 100,
          message: result.message,
        });
        setTimeout(() => app.quit(), 400);
        return result;
      } catch (error) {
        console.error('[updater] mac install failed', error);
        emitUpdateStatus({
          state: 'error',
          version: targetVersion,
          downloadUrl: getReleasePageUrl(targetVersion),
          message: error?.message
            ? `Automatic update failed: ${error.message}`
            : 'Automatic update failed. Open the release page to try again.',
        });
        return {
          ok: false,
          reason: classifyUpdaterIssue(error?.message, 'download-failed'),
          message: error?.message || 'Unable to download and install the update right now.',
        };
      }
    }

    if (updateState.state === 'ready') {
      autoUpdater.quitAndInstall(false, true);
      return { ok: true };
    }

    if (updateState.state === 'available') {
      if (downloadTask) {
        return { ok: true, reason: 'in-progress' };
      }

      emitUpdateStatus({
        state: 'downloading',
        version: updateState.version,
        message: `Downloading v${updateState.version ?? ''}...`,
      });

      downloadTask = autoUpdater.downloadUpdate().finally(() => {
        downloadTask = null;
      });

      try {
        await downloadTask;
        return { ok: true };
      } catch (error) {
        console.error('[updater] download failed', error);
        emitUpdateStatus({
          state: 'error',
          version: updateState.version,
          downloadUrl: getReleasePageUrl(updateState.version),
          message: 'Download failed. Please retry.',
        });
        return {
          ok: false,
          reason: classifyUpdaterIssue(error?.message, 'download-failed'),
          message: error?.message || 'Unable to download update right now.',
        };
      }
    }

    emitUpdateStatus({
      state: 'error',
      message: 'No update is ready to install.',
    });
    return { ok: false, reason: 'not-ready', message: 'No update is ready to install.' };
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
  const activeWindow = BrowserWindow.getAllWindows()[0];
  if (!activeWindow) {
    app.quit();
    return;
  }
  activeWindow.webContents.send('app:before-quit');
  setTimeout(() => app.quit(), 800);
});
