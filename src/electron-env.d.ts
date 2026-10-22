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
        setSidebarTranslucency: (enabled: boolean, fallbackColor: string, themeSource: 'system' | 'light' | 'dark') => Promise<boolean>;
      };
      capture: {
        capturePage: () => Promise<string | null>;
        copyImage: (dataUrl: string) => Promise<boolean>;
        saveImage: (dataUrl: string) => Promise<'saved' | 'canceled' | 'failed'>;
        onRequest: (listener: () => void) => () => void;
      };
      lifecycle: {
        onBeforeQuit: (listener: () => Promise<void>) => () => void;
      };
    };
  }
}

export {};
