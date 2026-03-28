import { useCallback, useEffect, useState } from 'react';
import { UpdateStatus } from '../types/desktop';

const FALLBACK_STATUS: UpdateStatus = { state: 'idle', message: 'Desktop updater unavailable.' };

export function useDesktopUpdater() {
  const isDesktop = Boolean(window.noaDesktop);
  const [version, setVersion] = useState('web');
  const [status, setStatus] = useState<UpdateStatus>(FALLBACK_STATUS);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!window.noaDesktop) return;
    void window.noaDesktop.appInfo.getVersion().then(setVersion).catch(() => setVersion('unknown'));
    void window.noaDesktop.appUpdater.getStatus().then(setStatus).catch(() => setStatus(FALLBACK_STATUS));
    const off = window.noaDesktop.appUpdater.onStatusChange((next) => setStatus(next));
    return off;
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (!window.noaDesktop) return;
    setBusy(true);
    try {
      await window.noaDesktop.appUpdater.checkForUpdates();
    } finally {
      setBusy(false);
    }
  }, []);

  const installUpdate = useCallback(async () => {
    if (!window.noaDesktop) return;
    setBusy(true);
    try {
      await window.noaDesktop.appUpdater.quitAndInstall();
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    isDesktop,
    version,
    status,
    busy,
    checkForUpdates,
    installUpdate,
  };
}
