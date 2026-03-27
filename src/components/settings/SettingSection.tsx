import React from 'react';

interface SettingSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

export default function SettingSection({ title, description, children }: SettingSectionProps) {
  return (
    <div className="mb-10">
      <div className="mb-4">
        <h2 className="font-bold text-lg text-[#2D2D2D]">{title}</h2>
        {description && (
          <p className="text-sm text-[#2D2D2D]/70 mt-1">{description}</p>
        )}
      </div>
      <div className="bg-[#DCD9CE] border-2 border-[#2D2D2D] p-4">
        {children}
      </div>
    </div>
  );
}
