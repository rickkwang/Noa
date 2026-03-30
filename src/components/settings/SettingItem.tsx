import React from 'react';

interface SettingItemProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  stacked?: boolean;
}

export default function SettingItem({ label, description, children, stacked = false }: SettingItemProps) {
  if (stacked) {
    return (
      <div className="py-4 border-b border-[#2D2D2D]/20 last:border-0">
        <div className="font-bold text-sm text-[#2D2D2D]">{label}</div>
        {description && (
          <div className="text-xs text-[#2D2D2D]/70 mt-1 leading-relaxed">
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
    <div className="flex items-center justify-between py-4 border-b border-[#2D2D2D]/20 last:border-0">
      <div className="flex-1 pr-8 min-w-0">
        <div className="font-bold text-sm text-[#2D2D2D]">{label}</div>
        {description && (
          <div className="text-xs text-[#2D2D2D]/70 mt-1 leading-relaxed">
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0">
        {children}
      </div>
    </div>
  );
}
