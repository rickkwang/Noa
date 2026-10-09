// Validates the background colour the renderer asks the native window to adopt. It must track
// the app theme, or light "ghost" bands show during live resize. Only plain 6-digit hex is
// accepted: alpha changes window compositing, and a compromised renderer shouldn't pass arbitrary strings.
function resolveBackgroundColor(color) {
  if (typeof color !== 'string') return null;
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
}

function resolveSidebarWindowAppearance(enabled, fallbackColor, supportsVibrancy) {
  if (typeof enabled !== 'boolean' || typeof supportsVibrancy !== 'boolean') return null;
  const resolvedFallback = resolveBackgroundColor(fallbackColor);
  if (!resolvedFallback) return null;

  if (enabled && supportsVibrancy) {
    return { backgroundColor: '#00000000', vibrancy: 'menu' };
  }
  return { backgroundColor: resolvedFallback, vibrancy: null };
}

module.exports = { resolveBackgroundColor, resolveSidebarWindowAppearance };
