import React from 'react';

// One button language for the settings dialog. Each section used to spell its
// own className, which drifted into four heights (26/26/30/38px), three
// disabled opacities and buttons with no hover state at all.
//
// Two sizes only: `regular` for a setting's own action (the right-hand control
// of a SettingItem, or a section's action row), `compact` for actions nested
// inside something smaller — a confirm strip, a banner, a list row. Icons go
// 14px in regular buttons, 12px in compact ones.
//
// Radius is the literal `rounded-[3px]` on purpose: index.css restates that
// utility as 6px inside [data-settings-surface], which is what keeps buttons on
// the dialog's curve. The colour classes are the same literals the dark-theme
// remap already covers, so dark mode needs nothing here.
export type SettingsButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning';
export type SettingsButtonSize = 'regular' | 'compact';

const BASE =
  'inline-flex items-center justify-center font-bold border rounded-[3px] transition-colors ' +
  'active:opacity-70 disabled:opacity-60 disabled:pointer-events-none';

const SIZES: Record<SettingsButtonSize, string> = {
  regular: 'gap-2 px-4 py-2 text-sm',
  compact: 'gap-1.5 px-3 py-1 text-xs',
};

const VARIANTS: Record<SettingsButtonVariant, string> = {
  primary: 'bg-[#CC7D5E] text-white border-[#2D2D2B] hover:opacity-90',
  secondary: 'bg-[#F9F9F7] text-[#2D2D2B] border-[#2D2D2B] hover:bg-[#EFEAE3]',
  // Transparent border, not none, so it stands exactly as tall as its siblings.
  ghost: 'bg-transparent text-[#2D2D2B]/70 border-transparent hover:bg-[#EFEAE3] hover:text-[#2D2D2B]',
  danger: 'bg-transparent text-[#C24444] border-[#C24444] hover:bg-[#C24444]/10',
  warning: 'bg-[#EC9A3C] text-white border-[#2D2D2B] hover:opacity-90',
};

export function settingsButtonClass({
  variant = 'secondary',
  size = 'regular',
  className = '',
}: { variant?: SettingsButtonVariant; size?: SettingsButtonSize; className?: string } = {}): string {
  return `${BASE} ${SIZES[size]} ${VARIANTS[variant]}${className ? ` ${className}` : ''}`;
}

interface SettingsButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: SettingsButtonVariant;
  size?: SettingsButtonSize;
}

export default function SettingsButton({
  variant,
  size,
  className,
  type = 'button',
  ...props
}: SettingsButtonProps) {
  return <button type={type} className={settingsButtonClass({ variant, size, className })} {...props} />;
}
