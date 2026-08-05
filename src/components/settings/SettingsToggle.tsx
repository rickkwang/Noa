import React from 'react';

interface SettingsToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

export default function SettingsToggle({ checked, onChange, label }: SettingsToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-14 border border-[#2D2D2B] transition-colors active:translate-x-px active:translate-y-px ${checked ? 'bg-[#CC7D5E]' : 'bg-[#F9F9F7]'}`}
    >
      <span className={`absolute left-1 top-1 h-4 w-4 border border-[#2D2D2B] bg-[#F9F9F7] shadow-[2px_2px_0_0_rgba(45,45,43,1)] transition-transform ${checked ? 'translate-x-7' : 'translate-x-0'}`} />
    </button>
  );
}
