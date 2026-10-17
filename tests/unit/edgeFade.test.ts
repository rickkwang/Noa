import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* Scroll-edge fades are CSS only: a scroll-driven animation writes each edge from the scroll position, so no script
   runs per scroll frame. These pin the contract the surfaces depend on. */

const cssPath = fileURLToPath(new URL('../../src/index.css', import.meta.url));

const ruleBody = (css: string, selector: string) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no rule for ${selector}`);
  return css.slice(start, css.indexOf('\n}', start));
};

describe('scroll-edge fades', () => {
  it('registers the edge variables so the timelines can ease them', async () => {
    const css = await readFile(cssPath, 'utf8');
    for (const edge of ['top', 'bottom', 'left', 'right']) {
      expect(css).toContain(`@property --noa-fade-${edge} { syntax: '<number>'; inherits: false; initial-value: 0; }`);
    }
  });

  it('drives each vertical surface from its own scroll position, over the first and last 28px', async () => {
    const css = await readFile(cssPath, 'utf8');
    const panel = ruleBody(css, '.noa-edge-fade-y');
    expect(panel).toContain('animation-timeline: scroll(self block), scroll(self block);');
    expect(panel).toContain('animation-range: 0px 28px, calc(100% - 28px) 100%;');
    expect(panel).toContain('scroll-padding-block: 28px;');
    expect(ruleBody(css, '.noa-top-scroll-fade')).toContain('animation-timeline: scroll(self block);');
  });

  it('drives the tab strip from its own horizontal scroll position', async () => {
    const css = await readFile(cssPath, 'utf8');
    expect(ruleBody(css, '.noa-edge-fade-x')).toContain('animation-timeline: scroll(self inline), scroll(self inline);');
  });

  it('shares one tree timeline between the list and its toolbar seam', async () => {
    const css = await readFile(cssPath, 'utf8');
    expect(ruleBody(css, '.noa-sidebar-scroll-fade')).toContain('scroll-timeline: --noa-sidebar-tree block;');
    expect(ruleBody(css, '.noa-sidebar-fade-scope')).toContain('timeline-scope: --noa-sidebar-tree;');
    expect(ruleBody(css, '.noa-sidebar-toolbar-mask::after')).toContain('animation-timeline: --noa-sidebar-tree;');
  });

  it('ramps every surface on the same 5/15/30/50/70/85% curve over 28px', async () => {
    const css = await readFile(cssPath, 'utf8');
    for (const alpha of ['0.05', '0.15', '0.3', '0.5', '0.7', '0.85']) {
      expect(css).toContain(`rgb(0 0 0 / ${alpha}) calc(var(--noa-fade-top, 0)`);
      expect(css).toContain(`rgb(0 0 0 / ${alpha}) calc(var(--noa-fade-left, 0)`);
    }
    expect(css).toContain('rgb(0 0 0 / 0.85) calc(var(--noa-fade-top, 0) * 25.2px)');
    // Sidebar seam uses opacity, still gated on scroll.
    expect(css).toContain('opacity: var(--noa-fade-top, 0);');
  });

  it('steps aside while keyboard focus is inside a scroller', async () => {
    const css = await readFile(cssPath, 'utf8');
    for (const selector of ['.noa-top-scroll-fade', '.noa-edge-fade-x', '.noa-edge-fade-y', '.noa-sidebar-scroll-fade']) {
      expect(css).toContain(`${selector}:has(:focus-visible)`);
    }
    expect(css).toContain('--noa-fade-top: 0 !important;');
  });
});
