import React, { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { formatExportTimestamp } from '../lib/exportTimestamp';
import { BackupHealthStatus } from '../types';

interface BackupReminderBarProps {
  daysSinceExport: number | null;
  lastExportAt: string | null;
  backupHealth: BackupHealthStatus;
  onExportJson: () => void;
  onDismiss: () => void;
}

export default function BackupReminderBar({
  daysSinceExport,
  lastExportAt,
  backupHealth,
  onExportJson,
  onDismiss,
}: BackupReminderBarProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // 延迟入场，避免页面加载瞬间弹出
    const t = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(t);
  }, []);

  const message = daysSinceExport === null
    ? 'No backup yet'
    : `${daysSinceExport}d since last backup`;
  const statusColor = backupHealth === 'healthy'
    ? 'text-emerald-700'
    : backupHealth === 'warning'
      ? 'text-amber-700'
      : 'text-red-700';

  return (
    <div
      className="fixed bottom-16 right-4 z-40 font-redaction transition-all duration-300"
      style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(8px)', pointerEvents: visible ? 'auto' : 'none' }}
    >
      <div className="flex items-center gap-3 bg-[#EAE8E0] border border-[#2D2D2D]/30 shadow-[2px_2px_0px_0px_rgba(45,45,45,0.15)] px-3 py-2">
        <div className="flex flex-col">
          <span className={`text-[11px] ${statusColor}`}>{message} · JSON backup every 7d</span>
          <span className="text-[10px] text-[#2D2D2D]/50">
            Last export: {formatExportTimestamp(lastExportAt)}
          </span>
        </div>
        <button
          onClick={onExportJson}
          className="flex items-center gap-1 text-[11px] font-bold text-[#B89B5E] border border-[#B89B5E]/50 px-2 py-0.5 hover:bg-[#B89B5E]/10 active:opacity-70 transition-colors shrink-0"
        >
          <Download size={11} />
          Export
        </button>
        <button
          onClick={onDismiss}
          className="text-[#2D2D2D]/30 hover:text-[#2D2D2D]/70 active:opacity-70 transition-colors"
          title="Remind me in 3 days"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
