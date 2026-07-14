function installSingleInstanceGuard({ app, getWindow, createWindow }) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }

  app.on('second-instance', () => {
    const existing = getWindow();
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return;
    }

    if (app.isReady()) createWindow();
  });

  return true;
}

module.exports = { installSingleInstanceGuard };
