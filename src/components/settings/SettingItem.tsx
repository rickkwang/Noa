import React from 'react';
import { settingAnchorId } from './settingsIndex';

interface SettingItemProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  stacked?: boolean;
}

export default function SettingItem({ label, description, children, stacked = false }: SettingItemProps) {
  // Anchor for the settings search: results scroll to the item and flash it.
  // Derived from the label so no call site has to pass an id and none can go
  // stale against the index.
  const anchorId = settingAnchorId(label);
  // The row is a labelled group, not a bare div. The rebuild in a8e3e3f moved
  // these labels out of the controls' own text — "Import Vault Folder" became a
  // button reading "Choose Folder" — which left several controls announcing
  // nothing that identifies them. Naming the group restores that without
  // renaming the controls, which matters because a row can hold more than one
  // (Vault Folder carries both Disconnect and Retry Sync).
  const labelId = `${anchorId}-label`;

  if (stacked) {
    return (
      <div id={anchorId} role="group" aria-labelledby={labelId} className="py-4 border-b border-[var(--divider-subtle)] last:border-0 scroll-mt-16">
        <div id={labelId} className="font-medium text-sm text-[#2D2D2B]">{label}</div>
        {description && (
          <div className="text-xs text-[#2D2D2B]/70 mt-1 leading-relaxed">
            {description}
          </div>
        )}
        <div className="mt-3">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div id={anchorId} role="group" aria-labelledby={labelId} className="flex flex-col gap-3 py-4 border-b border-[var(--divider-subtle)] last:border-0 scroll-mt-16 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 md:flex-1 md:pr-8">
        <div id={labelId} className="font-medium text-sm text-[#2D2D2B]">{label}</div>
        {description && (
          <div className="text-xs text-[#2D2D2B]/70 mt-1 leading-relaxed">
            {description}
          </div>
        )}
      </div>
      <div className="w-full md:w-auto md:shrink-0">
        {children}
      </div>
    </div>
  );
}
