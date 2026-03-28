import React from 'react';
import { RefreshCcw, ExternalLink } from 'lucide-react';
import SettingSection from '../SettingSection';
import SettingItem from '../SettingItem';
import { useDesktopUpdater } from '../../../hooks/useDesktopUpdater';

export default function AppUpdateSettings() {
  const { isDesktop, version, status, busy, checkForUpdates, installUpdate } = useDesktopUpdater();

  const statusColor =
    status.state === 'error' ? 'text-red-600' :
    status.state === 'available' ? 'text-emerald-700' :
    'text-[#2D2D2D]/70';

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

      {/* Update Status: full-width vertical layout to prevent label wrapping */}
      <div className="py-4 border-b border-[#2D2D2D]/20 last:border-0 space-y-3">
        <div>
          <div className="font-bold text-sm text-[#2D2D2D]">Update Status</div>
          <div className="text-xs text-[#2D2D2D]/70 mt-1 leading-relaxed">Check GitHub Releases for the latest version.</div>
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
            disabled={!isDesktop || busy || status.state !== 'available'}
            className="flex items-center justify-center gap-2 bg-[#B89B5E] text-white px-4 py-2 font-bold border-2 border-[#2D2D2D] transition-colors text-sm disabled:opacity-60 disabled:pointer-events-none active:opacity-70"
          >
            <ExternalLink size={14} />
            <span>Open Download Page</span>
          </button>
        </div>
      </div>
    </SettingSection>
  );
}
