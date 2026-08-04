// Validates the background color the renderer asks the native window to adopt.
// The native BrowserWindow backgroundColor is what macOS paints at the window
// edges while renderer frames lag during live resize — it must track the app
// theme or dark mode shows light "ghost" bands when the window is resized.
// Only plain 6-digit hex is accepted so a compromised renderer can't smuggle
// alpha (transparent windows change compositing) or arbitrary strings.
function resolveBackgroundColor(color) {
  if (typeof color !== 'string') return null;
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
}

function resolveSidebarWindowAppearance(enabled, fallbackColor, supportsVibrancy) {
  if (typeof enabled !== 'boolean' || typeof supportsVibrancy !== 'boolean') return null;
  const resolvedFallback = resolveBackgroundColor(fallbackColor);
  if (!resolvedFallback) return null;

  if (enabled && supportsVibrancy) {
    return { backgroundColor: '#00000000', vibrancy: 'sidebar' };
  }
  return { backgroundColor: resolvedFallback, vibrancy: null };
}

module.exports = { resolveBackgroundColor, resolveSidebarWindowAppearance };
