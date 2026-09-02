// Pure policy for renderer navigation and window.open targets.
// Kept free of Electron imports so it can be unit-tested directly.

const path = require('path');

/**
 * Is this file: URL inside the packaged bundle directory?
 *
 * bundleDir arrives as a raw filesystem path while pathname is percent-encoded,
 * so decode before comparing or a bundle installed under a path containing a
 * space ("/Applications/My App.app/...") never matches its own %20 form.
 * normalize() then collapses any dot segments the URL parser left behind.
 *
 * @param {URL} parsed
 * @param {string | undefined} bundleDir
 */
function isInsideBundleDir(parsed, bundleDir) {
  if (!bundleDir) return false;
  // file://host/path would resolve somewhere else entirely; only local paths.
  if (parsed.host !== '') return false;

  let decoded;
  try {
    decoded = decodeURIComponent(parsed.pathname);
  } catch {
    return false;
  }
  if (decoded.includes('\0')) return false;

  const target = path.posix.normalize(decoded);
  const root = path.posix.normalize(bundleDir).replace(/\/$/, '');
  // A root-normalized bundleDir ('/') would empty the prefix and match
  // every absolute path; fail closed instead.
  if (!root) return false;
  return target === root || target.startsWith(`${root}/`);
}

/**
 * @param {string} targetUrl
 * @param {{ isDev: boolean, bundleDir?: string }} env
 *   bundleDir — absolute path of the packaged dist/ directory. Omitted or
 *   empty means no file: URL can be trusted, so they are all denied.
 * @returns {'allow' | 'open-external' | 'deny'}
 *   allow         — in-app navigation (dev server origin, or inside the packaged bundle)
 *   open-external — hand to shell.openExternal (http/https/mailto)
 *   deny          — block (javascript:, data:, unparseable, file: outside the bundle)
 */
function resolveNavigationPolicy(targetUrl, { isDev, bundleDir }) {
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
    // Packaged app loads the bundle via loadFile. Only the bundle itself is
    // in-app navigable — any other local file would be rendered in a window
    // that carries the preload bridge.
    return isInsideBundleDir(parsed, bundleDir) ? 'allow' : 'deny';
  }

  if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:') {
    return 'open-external';
  }
  return 'deny';
}

module.exports = { resolveNavigationPolicy };
