import type { UpdateStatus } from './types/desktop';

declare global {
  interface Window {
    noaDesktop?: {
      appInfo: {
        getVersion: () => Promise<string>;
      };
      appUpdater: {
        checkForUpdates: () => Promise<boolean>;
        quitAndInstall: () => Promise<boolean>;
        openDownloadUrl: (url: string) => Promise<boolean>;
        getStatus: () => Promise<UpdateStatus>;
        onStatusChange: (listener: (status: UpdateStatus) => void) => () => void;
      };
      appearance: {
        setWindowBackgroundColor: (color: string) => Promise<boolean>;
      };
      lifecycle: {
        onBeforeQuit: (listener: () => void) => () => void;
      };
    };
  }
}

export {};
