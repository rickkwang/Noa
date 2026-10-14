// Shared surface and border for settings text inputs.
export function settingsFieldClass(className = ''): string {
  return `noa-settings-field h-8 rounded-lg text-sm outline-none${className ? ` ${className}` : ''}`;
}
