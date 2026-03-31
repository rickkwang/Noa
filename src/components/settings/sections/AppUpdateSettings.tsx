import React from 'react';
import { RefreshCcw, Download } from 'lucide-react';
import SettingSection from '../SettingSection';
import SettingItem from '../SettingItem';
import { useDesktopUpdater } from '../../../hooks/useDesktopUpdater';

export default function AppUpdateSettings() {
  const { isDesktop, version, status, busy, checkForUpdates, installUpdate } = useDesktopUpdater();

  const statusColor =
    status.state === 'error' ? 'text-red-600' :
    status.state === 'available' || status.state === 'ready' ? 'text-emerald-700' :
    'text-[#2D2D2D]/70';

  const installLabel =
    status.downloadUrl ? 'Open Release Page' :
    status.state === 'ready' ? 'Restart & Install' :
    status.state === 'available' ? 'Download Update' :
    status.state === 'downloading' ? 'Downloading...' :
    'Download Update';

  const InstallIcon = Download;

  const installDisabled = !isDesktop || busy ||
    (!status.downloadUrl && status.state !== 'available' && status.state !== 'ready');

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

      <div className="py-4 border-b border-[#2D2D2D]/20 last:border-0 space-y-3">
        <div>
          <div className="font-bold text-sm text-[#2D2D2D]">Update Status</div>
          <div className="text-xs text-[#2D2D2D]/70 mt-1 leading-relaxed">Updates are downloaded and installed inside the app.</div>
        </div>
        <div className={`text-sm break-words ${statusColor}`}>
          <span className="font-bold uppercase tracking-wider mr-2">{status.state}</span>
          <span>{status.message || (status.state === 'idle' ? 'Click "Check Updates" to check.' : '')}</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => void checkForUpdates()}
            disabled={!isDesktop || busy}
            className="flex items-center justify-center gap-2 bg-[#EAE8E0] text-[#2D2D2D] px-4 py-2 font-bold border-2 border-[#2D2D2D] transition-colors text-sm disabled:opacity-60 disabled:pointer-events-none active:opacity-70"
          >
            <RefreshCcw size={14} className={busy ? 'animate-spin' : ''} />
            <span>{busy ? 'Checking…' : 'Check Updates'}</span>
          </button>
          <button
            onClick={() => void installUpdate()}
            disabled={installDisabled}
            className="flex items-center justify-center gap-2 bg-[#B89B5E] text-white px-4 py-2 font-bold border-2 border-[#2D2D2D] transition-colors text-sm disabled:opacity-60 disabled:pointer-events-none active:opacity-70"
          >
            <InstallIcon size={14} />
            <span>{installLabel}</span>
          </button>
        </div>
      </div>
    </SettingSection>
  );
}
