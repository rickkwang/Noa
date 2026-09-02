// Pure policy for renderer permission checks and requests.
// Kept free of Electron imports so it can be unit-tested directly.

// The window only ever loads Noa's own local bundle, but a blanket grant would
// still hand camera, microphone, geolocation and friends to anything that
// managed to run script inside it. Allow exactly what the app calls, deny the
// rest — the renderer needs no other capability.
//
// fileSystem
//   Vault and backup directory handles. The packaged app runs from a file://
//   origin, which Chromium treats as opaque and so cannot persist File System
//   Access grants across relaunches — without an affirmative grant the restored
//   handle reads back as 'prompt' on every launch, the bootstrap scan fails with
//   NotAllowedError, and the "reconnect vault" error surfaces each time.
//   Directories are only ever obtained through the native picker, so granting
//   this re-authorizes a path the user already chose; it cannot reach elsewhere.
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
