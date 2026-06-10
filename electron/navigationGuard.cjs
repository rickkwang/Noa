// Pure policy for renderer navigation and window.open targets.
// Kept free of Electron imports so it can be unit-tested directly.

/**
 * @param {string} targetUrl
 * @param {{ isDev: boolean }} env
 * @returns {'allow' | 'open-external' | 'deny'}
 *   allow         — in-app navigation (dev server origin, or the packaged file: bundle)
 *   open-external — hand to shell.openExternal (http/https/mailto)
 *   deny          — block (javascript:, data:, unparseable, file: outside the bundle context)
 */
function resolveNavigationPolicy(targetUrl, { isDev }) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return 'deny';
  }

  if (isDev) {
    if (parsed.origin === 'http://127.0.0.1:3000' || parsed.origin === 'http://localhost:3000') {
      return 'allow';
    }
  } else if (parsed.protocol === 'file:') {
    // Packaged app loads the bundle via loadFile; in-bundle navigation is fine.
    return 'allow';
  }

  if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:') {
    return 'open-external';
  }
  return 'deny';
}

module.exports = { resolveNavigationPolicy };
