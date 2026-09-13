function installCloseGuard({ app, win, ipcMain }) {
  let pending = false;
  let allowClose = false;
  let quitting = false;
  let ready = false;

  const requestSave = () => {
    if (pending) return;
    pending = true;
    win.webContents.send('app:before-quit');
  };
  const beforeQuit = (event) => {
    if (allowClose || !ready) return;
    event.preventDefault();
    quitting = true;
    requestSave();
  };
  const onClose = (event) => {
    if (allowClose || !ready) return;
    event.preventDefault();
    requestSave();
  };
  const onSaved = (event, success) => {
    if (event.sender !== win.webContents || !pending) return;
    pending = false;
    if (success !== true) {
      quitting = false;
      return;
    }
    allowClose = true;
    if (quitting) app.quit();
    else win.close();
  };
  const onReady = (event) => {
    if (event.sender === win.webContents) ready = true;
  };
  app.on('before-quit', beforeQuit);
  win.on('close', onClose);
  ipcMain.on('app:save-complete', onSaved);
  ipcMain.on('app:save-ready', onReady);
  win.once('closed', () => {
    app.removeListener('before-quit', beforeQuit);
    ipcMain.removeListener('app:save-complete', onSaved);
    ipcMain.removeListener('app:save-ready', onReady);
  });
}

module.exports = { installCloseGuard };
