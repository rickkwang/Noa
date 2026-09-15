import React from 'react';
import { StorageEstimate } from '../../../../hooks/useStorageEstimate';
import { formatExportTimestamp } from '../../../../lib/exportTimestamp';
import { formatBytes } from '../../../../lib/formatBytes';
import { BackupHealthStatus } from '../../../../types';
import SettingItem from '../../SettingItem';
import SettingsButton from '../../SettingsButton';
import SettingSection from '../../SettingSection';
import { Download, FileArchive, FileText, Loader2 } from '@/src/lib/icons';

interface BackupSectionProps {
  exportingZip: boolean;
  exportingHtml: boolean;
  onExportJson: () => void;
  onExportZip: () => void;
  onExportHtmlZip: () => void;
  storageEstimate?: StorageEstimate | null;
  backupHealth: BackupHealthStatus;
  daysSinceExport: number | null;
  lastExportAt: string | null;
}

export default function BackupSection({
  exportingZip,
  exportingHtml,
  onExportJson,
  onExportZip,
  onExportHtmlZip,
  storageEstimate,
  backupHealth,
  daysSinceExport,
  lastExportAt,
}: BackupSectionProps) {
  const showStorage = storageEstimate?.supported === true;
  const healthLabel = backupHealth === 'healthy'
    ? 'Healthy'
    : backupHealth === 'warning'
      ? 'Warning'
      : 'Risk';
  const healthColor = backupHealth === 'healthy'
    ? 'text-[#37876B]'
    : backupHealth === 'warning'
      ? 'text-[#A26721]'
      : 'text-[#A93B3B]';
  return (
    <SettingSection title="Backup" description="Export your data for safekeeping.">
      <div className="pb-2 space-y-1 text-xs">
        <div className={`font-bold ${healthColor}`}>Backup health: {healthLabel}</div>
        <div className="text-[#2D2D2B]/60">
          Last export: {formatExportTimestamp(lastExportAt)}
          {daysSinceExport !== null ? ` (${daysSinceExport} day(s) ago)` : ''}
        </div>
        <div className="text-[#2D2D2B]/60">Backup health is based on JSON or Vault exports.</div>
        <div className="text-[#2D2D2B]/60">Recommended cadence: export JSON or Vault at least every 7 days.</div>
      </div>
      {showStorage && storageEstimate && (
        <div className="pb-2 space-y-1">
          <div className="text-xs text-[#2D2D2B]/60 font-redaction">
            Storage used: {formatBytes(storageEstimate.usageBytes)} / ~{formatBytes(storageEstimate.quotaBytes)} (estimated)
          </div>
          <div className="h-1 w-full bg-[#2D2D2B]/10 rounded-full overflow-hidden">
            <div
              className="h-full transition-[width]"
              style={{
                width: `${storageEstimate.ratio * 100}%`,
                backgroundColor: storageEstimate.ratio > 0.8 ? '#EC9A3C' : '#CC7D5E',
              }}
            />
          </div>
          {storageEstimate.ratio > 0.8 && (
            <p className="text-xs text-[#D9862B] font-redaction">
              Storage is over 80% full. Consider exporting and clearing old data.
            </p>
          )}
        </div>
      )}
      <SettingItem label="Export JSON Backup" description="Complete backup including metadata and settings.">
        <SettingsButton variant="primary" onClick={onExportJson}>
          <Download size={14} />
          <span>Export JSON</span>
        </SettingsButton>
      </SettingItem>

      <SettingItem label="Export Vault" description="Export a local vault-style ZIP with markdown notes, attachments, and a manifest.">
        <SettingsButton onClick={onExportZip} disabled={exportingZip}>
          {exportingZip ? <Loader2 size={14} className="animate-spin" /> : <FileArchive size={14} />}
          <span>{exportingZip ? 'Exporting…' : 'Export Vault'}</span>
        </SettingsButton>
      </SettingItem>

      <SettingItem label="Export as HTML" description="Export all notes as static HTML pages in a ZIP archive (not a backup).">
        <SettingsButton onClick={onExportHtmlZip} disabled={exportingHtml}>
          {exportingHtml ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
          <span>{exportingHtml ? 'Exporting…' : 'Export HTML'}</span>
        </SettingsButton>
      </SettingItem>
    </SettingSection>
  );
}
