export const DESKTOP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/**
 * @param {boolean} enabled
 * @returns {import('vite').HtmlTagDescriptor[]}
 */
export function desktopCspTags(enabled) {
  if (!enabled) return [];
  return [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: DESKTOP_CSP,
      },
      injectTo: 'head-prepend',
    },
  ];
}

/**
 * @param {boolean} enabled
 * @returns {import('vite').Plugin}
 */
export function desktopCspPlugin(enabled) {
  return {
    name: 'noa-desktop-csp',
    transformIndexHtml: {
      order: 'post',
      handler() {
        return desktopCspTags(enabled);
      },
    },
  };
}
