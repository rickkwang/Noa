import { describe, expect, it } from 'vitest';
import { DESKTOP_CSP, desktopCspTags } from '../../scripts/desktop-csp.mjs';

describe('desktop CSP', () => {
  it('keeps production scripts local and disallows inline/eval execution', () => {
    const scriptPolicy = DESKTOP_CSP.split('; ').find((directive) => directive.startsWith('script-src'));
    expect(scriptPolicy).toBe("script-src 'self'");
    expect(DESKTOP_CSP).toContain("connect-src 'self'");
    expect(scriptPolicy).not.toContain('unsafe-inline');
    expect(scriptPolicy).not.toContain('unsafe-eval');
    expect(DESKTOP_CSP).not.toMatch(/https?:|wss?:/);
  });

  it('injects the policy only for desktop builds', () => {
    expect(desktopCspTags(true)).toEqual([
      expect.objectContaining({
        tag: 'meta',
        attrs: expect.objectContaining({
          'http-equiv': 'Content-Security-Policy',
          content: DESKTOP_CSP,
        }),
      }),
    ]);
    expect(desktopCspTags(false)).toEqual([]);
  });
});
