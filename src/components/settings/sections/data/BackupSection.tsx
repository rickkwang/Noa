import React from 'react';
import { Download, FileArchive, FileText, Loader2 } from '@/src/lib/icons';
import SettingItem from '../../SettingItem';
import SettingSection from '../../SettingSection';
import { StorageEstimate } from '../../../../hooks/useStorageEstimate';
import { BackupHealthStatus } from '../../../../types';
import { formatExportTimestamp } from '../../../../lib/exportTimestamp';

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

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
      <div className="px-1 pb-2 space-y-1 text-xs">
        <div className={`font-bold ${healthColor}`}>Backup health: {healthLabel}</div>
        <div className="text-[#2D2D2D]/60">
          Last export: {formatExportTimestamp(lastExportAt)}
          {daysSinceExport !== null ? ` (${daysSinceExport} day(s) ago)` : ''}
        </div>
        <div className="text-[#2D2D2D]/60">Backup health is based on JSON or Vault exports.</div>
        <div className="text-[#2D2D2D]/60">Recommended cadence: export JSON or Vault at least every 7 days.</div>
      </div>
      {showStorage && storageEstimate && (
        <div className="px-1 pb-2 space-y-1">
          <div className="text-xs text-[#2D2D2D]/60 font-redaction">
            Storage used: {formatBytes(storageEstimate.usageBytes)} / ~{formatBytes(storageEstimate.quotaBytes)} (estimated)
          </div>
          <div className="h-1 w-full bg-[#2D2D2D]/10 overflow-hidden">
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
        <button
          onClick={onExportJson}
          className="flex items-center justify-center space-x-2 bg-[#CC7D5E] text-white px-4 py-2 font-bold border-[1.75px] border-[#2D2D2D] transition-colors text-sm"
        >
          <Download size={14} />
          <span>Export JSON</span>
        </button>
      </SettingItem>

      <SettingItem label="Export Vault" description="Export a local vault-style ZIP with markdown notes, attachments, and a manifest.">
        <button
          onClick={onExportZip}
          disabled={exportingZip}
          className="flex items-center justify-center space-x-2 bg-[#CC7D5E] text-white px-4 py-2 font-bold border-[1.75px] border-[#2D2D2D] transition-colors text-sm disabled:opacity-60 disabled:pointer-events-none"
        >
          {exportingZip ? <Loader2 size={14} className="animate-spin" /> : <FileArchive size={14} />}
          <span>{exportingZip ? 'Exporting…' : 'Export Vault'}</span>
        </button>
      </SettingItem>

      <SettingItem label="Export as HTML" description="Export all notes as static HTML pages in a ZIP archive (not a backup).">
        <button
          onClick={onExportHtmlZip}
          disabled={exportingHtml}
          className="flex items-center justify-center space-x-2 bg-[#CC7D5E] text-white px-4 py-2 font-bold border-[1.75px] border-[#2D2D2D] transition-colors text-sm disabled:opacity-60 disabled:pointer-events-none"
        >
          {exportingHtml ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
          <span>{exportingHtml ? 'Exporting…' : 'Export HTML'}</span>
        </button>
      </SettingItem>
    </SettingSection>
  );
}
