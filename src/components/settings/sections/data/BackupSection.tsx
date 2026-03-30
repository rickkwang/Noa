import React from 'react';
import { Download, FileArchive, FileText, Loader2 } from 'lucide-react';
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
    ? 'text-emerald-700'
    : backupHealth === 'warning'
      ? 'text-amber-700'
      : 'text-red-700';
  return (
    <SettingSection title="Backup" description="Export your data for safekeeping.">
      <div className="px-1 pb-2 space-y-1 text-[11px]">
        <div className={`font-bold ${healthColor}`}>Backup health: {healthLabel}</div>
        <div className="text-[#2D2D2D]/60">
          Last export: {formatExportTimestamp(lastExportAt)}
          {daysSinceExport !== null ? ` (${daysSinceExport} day(s) ago)` : ''}
        </div>
        <div className="text-[#2D2D2D]/60">Recommended cadence: export JSON at least every 7 days.</div>
      </div>
      {showStorage && storageEstimate && (
        <div className="px-1 pb-2 space-y-1">
          <div className="text-[11px] text-[#2D2D2D]/60 font-redaction">
            Storage used: {formatBytes(storageEstimate.usageBytes)} / ~{formatBytes(storageEstimate.quotaBytes)} (estimated)
          </div>
          <div className="h-1 w-full bg-[#2D2D2D]/10 overflow-hidden">
            <div
              className="h-full transition-all"
              style={{
                width: `${storageEstimate.ratio * 100}%`,
                backgroundColor: storageEstimate.ratio > 0.8 ? '#F59E0B' : '#B89B5E',
              }}
            />
          </div>
          {storageEstimate.ratio > 0.8 && (
            <p className="text-[11px] text-amber-600 font-redaction">
              Storage is over 80% full. Consider exporting and clearing old data.
            </p>
          )}
        </div>
      )}
      <SettingItem label="Export as JSON" description="Complete backup including metadata and settings.">
        <button
          onClick={onExportJson}
          className="flex items-center justify-center space-x-2 bg-[#B89B5E] text-white px-4 py-2 font-bold border-2 border-[#2D2D2D] transition-colors text-sm"
        >
          <Download size={14} />
          <span>Export JSON</span>
        </button>
      </SettingItem>

      <SettingItem label="Export Vault" description="Export a local vault-style ZIP with markdown notes, attachments, and a manifest.">
        <button
          onClick={onExportZip}
          disabled={exportingZip}
          className="flex items-center justify-center space-x-2 bg-[#B89B5E] text-white px-4 py-2 font-bold border-2 border-[#2D2D2D] transition-colors text-sm disabled:opacity-60 disabled:pointer-events-none"
        >
          {exportingZip ? <Loader2 size={14} className="animate-spin" /> : <FileArchive size={14} />}
          <span>{exportingZip ? 'Exporting…' : 'Export Vault'}</span>
        </button>
      </SettingItem>

      <SettingItem label="Export as HTML" description="Export all notes as static HTML pages in a ZIP archive.">
        <button
          onClick={onExportHtmlZip}
          disabled={exportingHtml}
          className="flex items-center justify-center space-x-2 bg-[#B89B5E] text-white px-4 py-2 font-bold border-2 border-[#2D2D2D] transition-colors text-sm disabled:opacity-60 disabled:pointer-events-none"
        >
          {exportingHtml ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
          <span>{exportingHtml ? 'Exporting…' : 'Export HTML'}</span>
        </button>
      </SettingItem>
    </SettingSection>
  );
}
