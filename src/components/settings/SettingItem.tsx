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
      <div className="py-4 border-b-[1.75px] border-[#2D2D2D]/20 last:border-0">
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
    <div className="flex flex-col gap-3 py-4 border-b-[1.75px] border-[#2D2D2D]/20 last:border-0 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 md:flex-1 md:pr-8">
        <div className="font-bold text-sm text-[#2D2D2D]">{label}</div>
        {description && (
          <div className="text-xs text-[#2D2D2D]/70 mt-1 leading-relaxed">
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
