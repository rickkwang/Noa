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
      // Claude Code's switch: 36×20 track, 2px inset, 16px white knob with a soft lift.
      className={`relative h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${checked ? 'bg-[var(--accent-color,#CC7D5E)]' : 'bg-[var(--settings-switch-off)]'}`}
    >
      <span className={`block h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(11,11,11,0.06),0_2px_8px_rgba(11,11,11,0.08)] transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  );
}
