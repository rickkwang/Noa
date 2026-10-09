// Pure policy for renderer permission checks and requests.
// Kept free of Electron imports so it can be unit-tested directly.

// Default-deny: anything not listed here (camera, mic, geolocation, ...) is refused,
// since the renderer needs no other capability.
//
// fileSystem
//   Vault and backup directory handles. file:// is an opaque origin, so Chromium won't
//   persist File System Access grants across relaunches; without this grant the restored
//   handle reads 'prompt' and the bootstrap scan fails with NotAllowedError. Handles only
//   come from the native picker, so this re-authorizes a path the user already chose.
//
// clipboard-sanitized-write
//   navigator.clipboard.writeText for the preview pane's copy-code button.
const ALLOWED_PERMISSIONS = new Set(['fileSystem', 'clipboard-sanitized-write']);

/**
 * @param {string} permission
 * @returns {boolean}
 */
function isPermissionAllowed(permission) {
  return ALLOWED_PERMISSIONS.has(permission);
}

module.exports = { ALLOWED_PERMISSIONS, isPermissionAllowed };
