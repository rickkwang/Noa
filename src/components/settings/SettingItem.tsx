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

  if (stacked) {
    return (
      <div id={anchorId} className="py-4 border-b border-[var(--divider-subtle)] last:border-0 scroll-mt-16">
        <div className="font-medium text-sm text-[#2D2D2B]">{label}</div>
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
    <div id={anchorId} className="flex flex-col gap-3 py-4 border-b border-[var(--divider-subtle)] last:border-0 scroll-mt-16 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 md:flex-1 md:pr-8">
        <div className="font-medium text-sm text-[#2D2D2B]">{label}</div>
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
