const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const https = require('https');
const path = require('path');

const isDev = !app.isPackaged;
const DEV_URL = 'http://127.0.0.1:3000';

const GITHUB_OWNER = 'rickkwang';
const GITHUB_REPO = 'Noa';

let win;
let updateState = { state: 'idle', message: '' };

function emitUpdateStatus(payload) {
  updateState = payload;
  if (win && !win.isDestroyed()) {
    win.webContents.send('app-updater:status', payload);
  }
}

function checkVersionViaGitHub() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
      headers: { 'User-Agent': 'Noa-Desktop-Updater' },
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const releases = JSON.parse(data);
          const latest = releases.find(r => !r.draft && !r.prerelease)
                      || releases.find(r => !r.draft);
          if (!latest) return resolve(null);
          const dmgAsset = latest.assets?.find(a => a.name.endsWith('.dmg'));
          resolve({
            latestVersion: latest.tag_name.replace(/^v/, ''),
            downloadUrl: dmgAsset?.browser_download_url || latest.html_url,
          });
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
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
          click: () => {
            void doCheckForUpdates();
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
    void win.loadURL(DEV_URL);
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

async function doCheckForUpdates() {
  emitUpdateStatus({ state: 'checking', message: 'Checking for updates...' });
  try {
    const result = await checkVersionViaGitHub();
    if (!result) {
      emitUpdateStatus({ state: 'idle', message: 'No releases found.' });
      return;
    }
    const current = app.getVersion();
    const hasUpdate = result.latestVersion !== current;
    emitUpdateStatus(hasUpdate
      ? { state: 'available', version: result.latestVersion, downloadUrl: result.downloadUrl, message: `New version available: v${result.latestVersion}` }
      : { state: 'idle', message: `You're up to date (v${current}).` }
    );
  } catch {
    emitUpdateStatus({ state: 'error', message: 'Could not check for updates. Please check your connection.' });
  }
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  ipcMain.handle('app-info:get-version', () => app.getVersion());
  ipcMain.handle('app-updater:get-status', () => updateState);
  ipcMain.handle('app-updater:check', async () => {
    await doCheckForUpdates();
    return true;
  });
  ipcMain.handle('app-updater:quit-and-install', () => {
    if (updateState.downloadUrl) {
      void shell.openExternal(updateState.downloadUrl);
    }
    return true;
  });

  if (!isDev) {
    setTimeout(() => {
      void doCheckForUpdates();
    }, 10_000);
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
