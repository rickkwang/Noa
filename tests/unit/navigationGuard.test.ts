import { describe, expect, it } from 'vitest';
import { resolveNavigationPolicy } from '../../electron/navigationGuard.cjs';

describe('resolveNavigationPolicy', () => {
  it('sends external http(s) and mailto links to the system browser', () => {
    expect(resolveNavigationPolicy('https://example.com/page', { isDev: false })).toBe('open-external');
    expect(resolveNavigationPolicy('http://example.com', { isDev: false })).toBe('open-external');
    expect(resolveNavigationPolicy('mailto:hi@example.com', { isDev: false })).toBe('open-external');
  });

  it('allows in-app navigation for the packaged file bundle', () => {
    expect(resolveNavigationPolicy('file:///Applications/Noa.app/dist/index.html', { isDev: false })).toBe('allow');
  });

  it('allows the dev server origin only in dev mode', () => {
    expect(resolveNavigationPolicy('http://127.0.0.1:3000/', { isDev: true })).toBe('allow');
    expect(resolveNavigationPolicy('http://localhost:3000/notes', { isDev: true })).toBe('allow');
    // In production a localhost url is just an external link.
    expect(resolveNavigationPolicy('http://127.0.0.1:3000/', { isDev: false })).toBe('open-external');
  });

  it('denies dangerous or unparseable schemes', () => {
    expect(resolveNavigationPolicy('javascript:alert(1)', { isDev: false })).toBe('deny');
    expect(resolveNavigationPolicy('data:text/html,<script>1</script>', { isDev: false })).toBe('deny');
    expect(resolveNavigationPolicy('file:///etc/passwd', { isDev: true })).toBe('deny');
    expect(resolveNavigationPolicy('not a url', { isDev: false })).toBe('deny');
    expect(resolveNavigationPolicy('', { isDev: false })).toBe('deny');
  });
});
