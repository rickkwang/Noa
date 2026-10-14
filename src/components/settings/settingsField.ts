// Shared surface and border for settings text inputs.
export function settingsFieldClass(className = ''): string {
  return `bg-[#F9F9F7] border border-[#2D2D2B] rounded-chip text-sm outline-none${className ? ` ${className}` : ''}`;
}
