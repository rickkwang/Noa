import React, { useEffect, useState } from 'react';
import { AutoBackupStatus } from '../../../../hooks/useAutoBackup';
import { isFileSystemSupported } from '../../../../lib/backupDirectoryStorage';
import { DEFAULT_KEEP_BACKUPS } from '../../../../services/autoBackupService';
import SettingItem from '../../SettingItem';
import SettingSection from '../../SettingSection';
import { AlertTriangle, CheckCircle2, FolderOpen, Loader2 } from '@/src/lib/icons';

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
        <div className="px-1 py-3 text-xs text-[#2D2D2B]/70">
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
                className="px-3 py-1.5 text-xs font-bold bg-[#CC7D5E] text-white border-[1.75px] border-[#2D2D2B] hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : null}
                Run backup now
              </button>
              <button
                onClick={() => { void onDisconnect(); }}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-bold bg-[#F9F9F7] border-[1.75px] border-[#2D2D2B] hover:bg-[#EFEAE3] disabled:opacity-50"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={() => { void onChooseDirectory(); }}
              disabled={busy}
              className="px-3 py-1.5 text-xs font-bold bg-[#CC7D5E] text-white border-[1.75px] border-[#2D2D2B] hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
            >
              <FolderOpen size={12} />
              Choose folder
            </button>
          )}
        </div>
      </SettingItem>

      <SettingItem label="Last automatic backup" description={lastAutoBackupAt ? new Date(lastAutoBackupAt).toLocaleString() : 'No automatic backup has run yet.'}>
        <div className="text-xs font-bold text-[#2D2D2B]">
          {formatRelative(lastAutoBackupAt)}
        </div>
      </SettingItem>

      <SettingItem label="Retention" description={`The ${DEFAULT_KEEP_BACKUPS} most recent backup files are kept; older files are deleted automatically.`}>
        <div className="text-xs text-[#2D2D2B]/60">Keep {DEFAULT_KEEP_BACKUPS}</div>
      </SettingItem>

      {status === 'needs-reauth' && hasBackupHandle && (
        <div className="px-3 py-2 border-[1.75px] border-[#EC9A3C] bg-[#EC9A3C]/10 flex items-center justify-between gap-3 text-xs">
          <span className="text-[#74491A] flex items-center gap-1.5">
            <AlertTriangle size={12} /> Folder permission was revoked.
          </span>
          <button
            onClick={() => { void onReconnect(); }}
            className="px-3 py-1 text-xs font-bold bg-[#EC9A3C] text-white border-[1.75px] border-[#2D2D2B] hover:opacity-90"
          >
            Reconnect
          </button>
        </div>
      )}

      {status === 'error' && error && !bannerDismissed && (
        <div className="px-3 py-2 border-[1.75px] border-[#D45555]/60 bg-[#D45555]/10 flex items-center gap-1.5 text-xs text-[#A93B3B]">
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      {status === 'success' && !bannerDismissed && (
        <div className="px-3 py-2 border-[1.75px] border-[#4CAF8A] bg-[#4CAF8A]/10 flex items-center gap-1.5 text-xs text-[#2C6E57]">
          <CheckCircle2 size={12} /> Backup written · {formatRelative(lastAutoBackupAt)}
        </div>
      )}
    </SettingSection>
  );
}
