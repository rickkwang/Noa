import React from 'react';
import { RefreshCcw, Rocket } from 'lucide-react';
import SettingSection from '../SettingSection';
import SettingItem from '../SettingItem';
import { useDesktopUpdater } from '../../../hooks/useDesktopUpdater';

export default function AppUpdateSettings() {
  const { isDesktop, version, status, busy, checkForUpdates, installUpdate } = useDesktopUpdater();

  return (
    <SettingSection title="App Update" description="Desktop app version and update channel status.">
      {!isDesktop && (
        <div className="border border-[#2D2D2D]/20 bg-[#DCD9CE] px-3 py-2 text-xs text-[#2D2D2D]/70">
          You are using web mode. In-app updates are available in the Electron desktop build.
        </div>
      )}

      <SettingItem label="Current Version" description="Version reported by the desktop runtime.">
        <div className="bg-[#EAE8E0] border-2 border-[#2D2D2D] px-3 py-1.5 text-sm font-redaction">
          {version}
        </div>
      </SettingItem>

      <SettingItem label="Update Status" description="Check GitHub Releases for the latest version.">
        <div className="space-y-2">
          <div className="text-sm text-[#2D2D2D]">
            <span className="font-bold uppercase tracking-wider mr-2">{status.state}</span>
            <span className="text-[#2D2D2D]/70">
              {status.state === 'error'
                ? 'Could not check for updates. Please check your connection.'
                : (status.message || 'No status message.')}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                void checkForUpdates();
              }}
              disabled={!isDesktop || busy}
              className="flex items-center justify-center gap-2 bg-[#EAE8E0] text-[#2D2D2D] px-4 py-2 font-bold border-2 border-[#2D2D2D] shadow-[2px_2px_0px_0px_rgba(45,45,45,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-none transition-all text-sm disabled:opacity-60 disabled:pointer-events-none"
            >
              <RefreshCcw size={14} />
              <span>Check Updates</span>
            </button>
            <button
              onClick={() => {
                void installUpdate();
              }}
              disabled={!isDesktop || busy || status.state !== 'available'}
              className="flex items-center justify-center gap-2 bg-[#B89B5E] text-white px-4 py-2 font-bold border-2 border-[#2D2D2D] shadow-[2px_2px_0px_0px_rgba(45,45,45,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-none transition-all text-sm disabled:opacity-60 disabled:pointer-events-none"
            >
              <Rocket size={14} />
              <span>Open Download Page</span>
            </button>
          </div>
        </div>
      </SettingItem>
    </SettingSection>
  );
}
