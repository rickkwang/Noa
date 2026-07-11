import React from 'react';

interface SettingSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  bare?: boolean;
}

export default function SettingSection({ title, description, children, bare = false }: SettingSectionProps) {
  return (
    <div>
      <div className="mb-4">
        <h2 className="font-bold text-lg text-[#2D2D2B]">{title}</h2>
        {description && (
          <p className="text-sm text-[#2D2D2B]/70 mt-1">{description}</p>
        )}
      </div>
      {bare ? children : (
        <div className="bg-[#EFEAE3] border-[1.75px] border-[#2D2D2B] p-4">
          {children}
        </div>
      )}
    </div>
  );
}
