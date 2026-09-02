import { describe, expect, it } from 'vitest';
import { resolveNavigationPolicy } from '../../electron/navigationGuard.cjs';

const BUNDLE_DIR = '/Applications/Noa.app/Contents/Resources/app.asar/dist';
const packaged = { isDev: false, bundleDir: BUNDLE_DIR };

describe('resolveNavigationPolicy', () => {
  it('sends external http(s) and mailto links to the system browser', () => {
    expect(resolveNavigationPolicy('https://example.com/page', packaged)).toBe('open-external');
    expect(resolveNavigationPolicy('http://example.com', packaged)).toBe('open-external');
    expect(resolveNavigationPolicy('mailto:hi@example.com', packaged)).toBe('open-external');
  });

  it('allows in-app navigation for the packaged file bundle', () => {
    expect(resolveNavigationPolicy(`file://${BUNDLE_DIR}/index.html`, packaged)).toBe('allow');
    expect(resolveNavigationPolicy(`file://${BUNDLE_DIR}/assets/app.js`, packaged)).toBe('allow');
  });

  it('denies local files outside the bundle', () => {
    expect(resolveNavigationPolicy('file:///etc/passwd', packaged)).toBe('deny');
    expect(resolveNavigationPolicy('file:///Users/me/.ssh/id_rsa', packaged)).toBe('deny');
    // A sibling directory that merely shares the bundle's prefix.
    expect(resolveNavigationPolicy(`file://${BUNDLE_DIR}-evil/index.html`, packaged)).toBe('deny');
  });

  it('denies path traversal out of the bundle, including percent-encoded', () => {
    expect(resolveNavigationPolicy(`file://${BUNDLE_DIR}/../../../../etc/passwd`, packaged)).toBe('deny');
    expect(resolveNavigationPolicy(`file://${BUNDLE_DIR}/%2e%2e/%2e%2e/etc/passwd`, packaged)).toBe('deny');
    expect(resolveNavigationPolicy(`file://${BUNDLE_DIR}/%2E%2E/secrets`, packaged)).toBe('deny');
  });

  it('allows a bundle path that needs percent-decoding to match', () => {
    const spaced = '/Applications/My Notes.app/Contents/Resources/app.asar/dist';
    expect(
      resolveNavigationPolicy(`file://${spaced}/index.html`.replace(/ /g, '%20'), { isDev: false, bundleDir: spaced }),
    ).toBe('allow');
  });

  it('denies file urls carrying a host, and denies all file urls without a bundleDir', () => {
    expect(resolveNavigationPolicy(`file://evil.com${BUNDLE_DIR}/index.html`, packaged)).toBe('deny');
    // Fail closed: a caller that forgets bundleDir must not open the filesystem.
    expect(resolveNavigationPolicy(`file://${BUNDLE_DIR}/index.html`, { isDev: false })).toBe('deny');
    // A bundleDir of '/' would normalize to an empty prefix; it must not match everything.
    expect(resolveNavigationPolicy('file:///etc/passwd', { isDev: false, bundleDir: '/' })).toBe('deny');
  });

  it('allows the dev server origin only in dev mode', () => {
    expect(resolveNavigationPolicy('http://127.0.0.1:3000/', { isDev: true })).toBe('allow');
    expect(resolveNavigationPolicy('http://localhost:3000/notes', { isDev: true })).toBe('allow');
    // In production a localhost url is just an external link.
    expect(resolveNavigationPolicy('http://127.0.0.1:3000/', packaged)).toBe('open-external');
  });

  it('denies dangerous or unparseable schemes', () => {
    expect(resolveNavigationPolicy('javascript:alert(1)', packaged)).toBe('deny');
    expect(resolveNavigationPolicy('data:text/html,<script>1</script>', packaged)).toBe('deny');
    expect(resolveNavigationPolicy('file:///etc/passwd', { isDev: true })).toBe('deny');
    expect(resolveNavigationPolicy('not a url', packaged)).toBe('deny');
    expect(resolveNavigationPolicy('', packaged)).toBe('deny');
  });
});
