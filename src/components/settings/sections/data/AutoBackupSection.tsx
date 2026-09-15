import React, { useEffect, useState } from 'react';
import { AutoBackupStatus } from '../../../../hooks/useAutoBackup';
import { isFileSystemSupported } from '../../../../lib/backupDirectoryStorage';
import { DEFAULT_KEEP_BACKUPS } from '../../../../services/autoBackupService';
import SettingItem from '../../SettingItem';
import SettingsButton from '../../SettingsButton';
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
      <SettingSection title="Automatic Backup" description="Automatically save a snapshot to a folder on your disk every day.">
        <div className="py-3 text-xs text-[#2D2D2B]/70">
          Not supported in this browser. Use Chrome or the Noa desktop app.
        </div>
      </SettingSection>
    );
  }

  const busy = status === 'running';

  return (
    <SettingSection title="Automatic Backup" description="Writes a full snapshot to a folder on your disk on first launch each day. Keeps the most recent backups and deletes the rest.">
      <SettingItem label="Backup Folder" description={directoryName ? `Connected to "${directoryName}"` : 'No folder chosen yet.'}>
        <div className="flex gap-2">
          {hasBackupHandle ? (
            <>
              <SettingsButton variant="primary" onClick={() => { void onRunNow(); }} disabled={busy}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                Run backup now
              </SettingsButton>
              <SettingsButton onClick={() => { void onDisconnect(); }} disabled={busy}>
                Disconnect
              </SettingsButton>
            </>
          ) : (
            <SettingsButton variant="primary" onClick={() => { void onChooseDirectory(); }} disabled={busy}>
              <FolderOpen size={14} />
              Choose folder
            </SettingsButton>
          )}
        </div>
      </SettingItem>

      <SettingItem label="Last Automatic Backup" description={lastAutoBackupAt ? new Date(lastAutoBackupAt).toLocaleString() : 'No automatic backup has run yet.'}>
        <div className="text-xs font-bold text-[#2D2D2B]">
          {formatRelative(lastAutoBackupAt)}
        </div>
      </SettingItem>

      <SettingItem label="Retention" description={`The ${DEFAULT_KEEP_BACKUPS} most recent backup files are kept; older files are deleted automatically.`}>
        <div className="text-xs text-[#2D2D2B]/60">Keep {DEFAULT_KEEP_BACKUPS}</div>
      </SettingItem>

      {status === 'needs-reauth' && hasBackupHandle && (
        <div className="px-3 py-2 border border-[#EC9A3C] bg-[#EC9A3C]/10 rounded-[3px] flex items-center justify-between gap-3 text-xs">
          <span className="text-[#74491A] flex items-center gap-1.5">
            <AlertTriangle size={12} /> Folder permission was revoked.
          </span>
          <SettingsButton variant="warning" size="compact" onClick={() => { void onReconnect(); }}>
            Reconnect
          </SettingsButton>
        </div>
      )}

      {status === 'error' && error && !bannerDismissed && (
        <div className="px-3 py-2 border border-[#D45555]/60 bg-[#D45555]/10 rounded-[3px] flex items-center gap-1.5 text-xs text-[#A93B3B]">
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      {status === 'success' && !bannerDismissed && (
        <div className="px-3 py-2 border border-[#4CAF8A] bg-[#4CAF8A]/10 rounded-[3px] flex items-center gap-1.5 text-xs text-[#2C6E57]">
          <CheckCircle2 size={12} /> Backup written · {formatRelative(lastAutoBackupAt)}
        </div>
      )}
    </SettingSection>
  );
}
