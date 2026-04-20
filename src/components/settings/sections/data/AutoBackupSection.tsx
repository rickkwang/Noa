import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FolderOpen, Loader2 } from 'lucide-react';
import SettingItem from '../../SettingItem';
import SettingSection from '../../SettingSection';
import { isFileSystemSupported } from '../../../../lib/backupDirectoryStorage';
import { AutoBackupStatus } from '../../../../hooks/useAutoBackup';
import { DEFAULT_KEEP_BACKUPS } from '../../../../services/autoBackupService';

interface AutoBackupSectionProps {
  status: AutoBackupStatus;
  error: string | null;
  lastAutoBackupAt: string | null;
  directoryName: string | null;
  hasBackupHandle: boolean;
  onChooseDirectory: () => Promise<boolean> | void;
  onDisconnect: () => Promise<void> | void;
  onRunNow: () => Promise<boolean> | void;
  onReconnect: () => Promise<boolean> | void;
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'Never';
  const diffMs = Date.now() - t;
  if (diffMs < 60_000) return 'Just now';
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function AutoBackupSection({
  status,
  error,
  lastAutoBackupAt,
  directoryName,
  hasBackupHandle,
  onChooseDirectory,
  onDisconnect,
  onRunNow,
  onReconnect,
}: AutoBackupSectionProps) {
  // Auto-dismiss transient banners so repeated "Run backup now" gives fresh
  // feedback; otherwise the banner would sit stale and users can't tell if a
  // subsequent click did anything.
  const [bannerDismissed, setBannerDismissed] = useState(false);
  useEffect(() => {
    setBannerDismissed(false);
    if (status !== 'success' && status !== 'error') return;
    const ms = status === 'success' ? 4000 : 8000;
    const t = setTimeout(() => setBannerDismissed(true), ms);
    return () => clearTimeout(t);
  }, [status, lastAutoBackupAt, error]);

  if (!isFileSystemSupported()) {
    return (
      <SettingSection title="Automatic backup" description="Automatically save a snapshot to a folder on your disk every day.">
        <div className="px-1 py-3 text-xs text-[#2D2D2D]/70">
          Not supported in this browser. Use Chrome or the Noa desktop app.
        </div>
      </SettingSection>
    );
  }

  const busy = status === 'running';

  return (
    <SettingSection title="Automatic backup" description="Writes a full snapshot to a folder on your disk on first launch each day. Keeps the most recent backups and deletes the rest.">
      <SettingItem label="Backup folder" description={directoryName ? `Connected to "${directoryName}"` : 'No folder chosen yet.'}>
        <div className="flex gap-2">
          {hasBackupHandle ? (
            <>
              <button
                onClick={() => { void onRunNow(); }}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-bold bg-[#B89B5E] text-white border-2 border-[#2D2D2D] hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : null}
                Run backup now
              </button>
              <button
                onClick={() => { void onDisconnect(); }}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-bold bg-[#EAE8E0] border-2 border-[#2D2D2D] hover:bg-[#DCD9CE] disabled:opacity-50"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={() => { void onChooseDirectory(); }}
              disabled={busy}
              className="px-3 py-1.5 text-xs font-bold bg-[#B89B5E] text-white border-2 border-[#2D2D2D] hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
            >
              <FolderOpen size={12} />
              Choose folder
            </button>
          )}
        </div>
      </SettingItem>

      <SettingItem label="Last automatic backup" description={lastAutoBackupAt ? new Date(lastAutoBackupAt).toLocaleString() : 'No automatic backup has run yet.'}>
        <div className="text-xs font-bold text-[#2D2D2D]">
          {formatRelative(lastAutoBackupAt)}
        </div>
      </SettingItem>

      <SettingItem label="Retention" description={`The ${DEFAULT_KEEP_BACKUPS} most recent backup files are kept; older files are deleted automatically.`}>
        <div className="text-xs text-[#2D2D2D]/60">Keep {DEFAULT_KEEP_BACKUPS}</div>
      </SettingItem>

      {status === 'needs-reauth' && hasBackupHandle && (
        <div className="px-3 py-2 border-2 border-amber-500 bg-amber-50 flex items-center justify-between gap-3 text-xs">
          <span className="text-amber-900 flex items-center gap-1.5">
            <AlertTriangle size={12} /> Folder permission was revoked.
          </span>
          <button
            onClick={() => { void onReconnect(); }}
            className="px-3 py-1 text-xs font-bold bg-amber-500 text-white border-2 border-[#2D2D2D] hover:opacity-90"
          >
            Reconnect
          </button>
        </div>
      )}

      {status === 'error' && error && !bannerDismissed && (
        <div className="px-3 py-2 border-2 border-red-400 bg-red-50 flex items-center gap-1.5 text-xs text-red-700">
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      {status === 'success' && !bannerDismissed && (
        <div className="px-3 py-2 border-2 border-emerald-500 bg-emerald-50 flex items-center gap-1.5 text-xs text-emerald-800">
          <CheckCircle2 size={12} /> Backup written · {formatRelative(lastAutoBackupAt)}
        </div>
      )}
    </SettingSection>
  );
}
