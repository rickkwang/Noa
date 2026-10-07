// Shared surface, border and focus ring for settings text inputs.
export function settingsFieldClass(className = ''): string {
  return `bg-[#F9F9F7] border border-[#2D2D2B] rounded-[3px] text-sm outline-none focus:border-[#CC7D5E]${className ? ` ${className}` : ''}`;
}
