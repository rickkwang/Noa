import React, { useLayoutEffect } from 'react';
import { useIsDark } from '../hooks/useIsDark';
import { AppSettings } from '../types';

interface ThemeInjectorProps {
  settings: AppSettings;
}

export default function ThemeInjector({ settings }: ThemeInjectorProps) {
  const isDark = useIsDark(settings.appearance.theme);

  useLayoutEffect(() => {
    const root = document.documentElement;

    if (isDark) {
      root.setAttribute('data-theme', 'dark');
      root.style.setProperty('--bg-primary', '#2D2D2B');
      root.style.setProperty('--bg-secondary', '#252523');
      root.style.setProperty('--bg-tertiary', '#302F2C');
      // Sidebar sits one step below the editor plane: -1.2% OKLCH lightness
      // here, -1.5% in light. Far under the 4% an app shell would normally
      // use, because the brief was a plane change you notice without being
      // able to point at it. Critically it is the SAME hue: 45/45/43 scaled to
      // 42/42/40 keeps the red-blue spread at 2, so the step reads as depth
      // rather than as a colour cast.
      root.style.setProperty('--bg-sidebar', '#2A2A28');
      root.style.setProperty('--sidebar-preview-shadow', '6px 0 14px rgba(18,18,16,0.14)');
      // Dark row highlights are restated per-rule in index.css (translucent
      // white, which re-adapts to any floor), so nothing reads this token
      // today — the dark rules there outrank the shared one that consumes it.
      // It exists so the pair is symmetric: any rule added later that reaches
      // for --bg-sidebar-raised resolves to a dark value instead of silently
      // taking the light #EAE5DE fallback baked into the shared rule.
      root.style.setProperty('--bg-sidebar-raised', 'rgba(249,249,247,0.13)');
      root.style.setProperty('--text-primary', '#F9F9F7');
      root.style.setProperty('--text-secondary', 'rgba(249,249,247,0.5)');
      root.style.setProperty('--divider-subtle', 'rgba(249,249,247,0.15)');
      root.style.setProperty('--border-default', 'var(--divider-subtle)');
      root.style.setProperty('--border-strong', 'rgba(249,249,247,0.30)');
      root.style.setProperty('--border-primary', 'var(--divider-subtle)');
      root.style.setProperty('--panel-divider', 'var(--divider-subtle)');
    } else {
      root.removeAttribute('data-theme');
      root.style.setProperty('--bg-primary', '#F9F9F7');
      root.style.setProperty('--bg-secondary', '#EFEAE3');
      root.style.setProperty('--bg-tertiary', '#E5DCD2');
      // Same hue as the editor plane, one step down: 249/249/247 scaled to
      // 244/244/242 holds the red-blue spread at 2. An earlier pass used the
      // palette's warm paper tone here (#F3EFE7, spread 12) and it read as the
      // sidebar turning yellow rather than going deeper — at this size a hue
      // shift is far louder than a lightness shift.
      root.style.setProperty('--bg-sidebar', '#F4F4F2');
      root.style.setProperty('--sidebar-preview-shadow', '6px 0 14px rgba(45,45,43,0.07)');
      // The paired highlight token, light mode only: the row highlight has to
      // move down with the floor or it lands level with it. Kept on the warm
      // paper tone, which is the brand at row scale, and placed so the solid
      // highlight keeps exactly the 4.3% gap it had over the editor plane.
      root.style.setProperty('--bg-sidebar-raised', '#EAE5DE');
      root.style.setProperty('--text-primary', '#2D2D2B');
      root.style.setProperty('--text-secondary', 'rgba(45,45,43,0.55)');
      root.style.setProperty('--divider-subtle', '#E6E2DA');
      root.style.setProperty('--border-default', 'var(--divider-subtle)');
      root.style.setProperty('--border-strong', '#E6E2DA');
      root.style.setProperty('--border-primary', 'var(--border-default)');
      root.style.setProperty('--panel-divider', 'var(--divider-subtle)');
    }

    // Accent is a fixed theme token (coral in both themes), not user-configurable.
    root.style.setProperty('--accent-color', '#CC7D5E');
    root.dataset.pointerCursors = settings.appearance.usePointerCursors ? 'enabled' : 'disabled';

    // BrowserWindow is the backing plane for the whole renderer, so it follows
    // the primary canvas during startup and live resize. The sidebar preview's
    // full-height renderer layer also paints --bg-primary, while the expanded
    // sidebar keeps its separate --bg-sidebar floor.
    void window.noaDesktop?.appearance?.setWindowBackgroundColor(isDark ? '#2D2D2B' : '#F9F9F7')
      ?.catch(() => { /* desktop-only; ignore if the bridge is unavailable */ });
  }, [isDark, settings.appearance.usePointerCursors]);

  const fontFamilyStyle = settings.appearance.fontFamily === 'font-iosevka' ? '"Iosevka Nerd Font Mono", "Iosevka NF", "JetBrains Mono", monospace' :
                          settings.appearance.fontFamily === 'font-redaction' ? '"Redaction 50", serif' :
                          settings.appearance.fontFamily === 'font-pixelify' ? '"Pixelify Sans", sans-serif' :
                          settings.appearance.fontFamily === 'font-work-sans' ? '"Work Sans", sans-serif' :
                          settings.appearance.fontFamily;

  return (
    <style>{`
      /* CSS variable-based overrides — work in both light and dark */
      .bg-\\[\\#F9F9F7\\]     { background-color: var(--bg-primary) !important; }
      .bg-\\[\\#EFEAE3\\]     { background-color: var(--bg-secondary) !important; }
      .bg-\\[\\#CC7D5E\\]     { background-color: var(--accent-color) !important; }
      .bg-\\[\\#F9F9F7\\]\\/50 { background-color: color-mix(in srgb, var(--bg-primary) 50%, transparent) !important; }
      .bg-\\[\\#F9F9F7\\]\\/60 { background-color: color-mix(in srgb, var(--bg-primary) 60%, transparent) !important; }
      .bg-\\[\\#F9F9F7\\]\\/80 { background-color: color-mix(in srgb, var(--bg-primary) 80%, transparent) !important; }
      .bg-\\[\\#F9F9F7\\]\\/90 { background-color: color-mix(in srgb, var(--bg-primary) 90%, transparent) !important; }
      .bg-\\[\\#EFEAE3\\]\\/30 { background-color: color-mix(in srgb, var(--bg-secondary) 30%, transparent) !important; }
      .bg-\\[\\#EFEAE3\\]\\/50 { background-color: color-mix(in srgb, var(--bg-secondary) 50%, transparent) !important; }
      .bg-\\[\\#CC7D5E\\]\\/10 { background-color: color-mix(in srgb, var(--accent-color) 10%, transparent) !important; }

      .text-\\[\\#2D2D2B\\]     { color: var(--text-primary) !important; }
      .text-\\[\\#CC7D5E\\]     { color: var(--accent-color) !important; }
      .text-\\[\\#2D2D2B\\]\\/50 { color: color-mix(in srgb, var(--text-primary) 50%, transparent) !important; }
      .text-\\[\\#2D2D2B\\]\\/60 { color: color-mix(in srgb, var(--text-primary) 60%, transparent) !important; }
      .text-\\[\\#2D2D2B\\]\\/70 { color: color-mix(in srgb, var(--text-primary) 70%, transparent) !important; }
      .text-\\[\\#2D2D2B\\]\\/30 { color: color-mix(in srgb, var(--text-primary) 30%, transparent) !important; }
      .text-\\[\\#2D2D2B\\]\\/35 { color: color-mix(in srgb, var(--text-primary) 35%, transparent) !important; }
      .text-\\[\\#2D2D2B\\]\\/40 { color: color-mix(in srgb, var(--text-primary) 40%, transparent) !important; }
      .text-\\[\\#2D2D2B\\]\\/75 { color: color-mix(in srgb, var(--text-primary) 75%, transparent) !important; }
      .text-\\[\\#2D2D2B\\]\\/80 { color: color-mix(in srgb, var(--text-primary) 80%, transparent) !important; }
      .text-\\[\\#2D2D2B\\]\\/90 { color: color-mix(in srgb, var(--text-primary) 90%, transparent) !important; }
      .hover\\:text-\\[\\#CC7D5E\\]:hover { color: var(--accent-color) !important; }
      .hover\\:text-\\[\\#2D2D2B\\]:hover { color: var(--text-primary) !important; }
      .group:hover .group-hover\\:text-\\[\\#CC7D5E\\] { color: var(--accent-color) !important; }

      .border-\\[\\#2D2D2B\\]      { border-color: var(--border-default) !important; }
      .border-\\[\\#CC7D5E\\]      { border-color: var(--accent-color) !important; }
      .border-\\[\\#2D2D2B\\]\\/10 { border-color: var(--divider-subtle) !important; }
      .border-\\[\\#2D2D2B\\]\\/15 { border-color: var(--divider-subtle) !important; }
      .border-\\[\\#2D2D2B\\]\\/20 { border-color: var(--divider-subtle) !important; }
      .border-\\[\\#2D2D2B\\]\\/30 { border-color: var(--border-default) !important; }
      .border-\\[\\#2D2D2B\\]\\/40 { border-color: var(--border-strong) !important; }
      .border-\\[\\#2D2D2B\\]\\/50 { border-color: var(--border-strong) !important; }
      .border-\\[\\#2D2D2B\\]\\/60 { border-color: var(--border-strong) !important; }
      .border-\\[\\#2D2D2B\\]\\/90 { border-color: color-mix(in srgb, var(--text-primary) 90%, transparent) !important; }
      .hover\\:border-\\[\\#2D2D2B\\]:hover { border-color: var(--border-strong) !important; }
      .hover\\:border-\\[\\#CC7D5E\\]:hover  { border-color: var(--accent-color) !important; }
      .focus\\:border-\\[\\#CC7D5E\\]:focus  { border-color: var(--accent-color) !important; }
      .border-\\[\\#CC7D5E\\]\\/50 { border-color: color-mix(in srgb, var(--accent-color) 50%, transparent) !important; }
      .border-\\[\\#CC7D5E\\]\\/60 { border-color: color-mix(in srgb, var(--accent-color) 60%, transparent) !important; }

      .shadow-\\[4px_4px_0_0_rgba\\(45\\,45\\,43\\,1\\)\\] { box-shadow: 0 4px 12px 0 color-mix(in srgb, var(--border-strong) 28%, transparent) !important; }
      .shadow-\\[2px_2px_0_0_rgba\\(45\\,45\\,43\\,1\\)\\] { box-shadow: 0 2px 6px 0 color-mix(in srgb, var(--border-strong) 24%, transparent) !important; }
      .shadow-\\[inset_4px_0px_0px_0px_\\#CC7D5E\\]          { box-shadow: inset 4px 0px 0px 0px var(--accent-color) !important; }

      .selection\\:bg-\\[\\#CC7D5E\\] *::selection { background-color: color-mix(in srgb, var(--accent-color) 40%, transparent) !important; }
      .selection\\:bg-\\[\\#CC7D5E\\]::selection   { background-color: color-mix(in srgb, var(--accent-color) 40%, transparent) !important; }

      .prose-a\\:text-\\[\\#CC7D5E\\] a         { color: var(--accent-color) !important; }
      .prose-pre\\:text-\\[\\#2D2D2B\\] pre      { color: var(--text-primary) !important; }
      .prose-code\\:text-\\[\\#CC7D5E\\] code    { color: var(--accent-color) !important; }

      .font-redaction { font-family: ${fontFamilyStyle} !important; }
      body {
        background-color: var(--bg-primary);
        color: var(--text-primary);
        font-family: ${fontFamilyStyle} !important;
      }

      ${settings.appearance.usePointerCursors ? '' : `
      html[data-pointer-cursors="disabled"] button:not(:disabled),
      html[data-pointer-cursors="disabled"] a[href],
      html[data-pointer-cursors="disabled"] summary,
      html[data-pointer-cursors="disabled"] [role="button"],
      html[data-pointer-cursors="disabled"] [role="switch"],
      html[data-pointer-cursors="disabled"] input[type="button"]:not(:disabled),
      html[data-pointer-cursors="disabled"] input[type="submit"]:not(:disabled),
      html[data-pointer-cursors="disabled"] input[type="reset"]:not(:disabled),
      html[data-pointer-cursors="disabled"] input[type="checkbox"]:not(:disabled),
      html[data-pointer-cursors="disabled"] input[type="radio"]:not(:disabled),
      html[data-pointer-cursors="disabled"] input[type="color"]:not(:disabled),
      html[data-pointer-cursors="disabled"] .cursor-pointer:not(.cursor-default):not(.cursor-text):not(.cursor-not-allowed):not(.cursor-col-resize):not(.cursor-row-resize):not(.cursor-zoom-in):not(.cursor-zoom-out) {
        cursor: default !important;
      }
      `}
    `}</style>
  );
}
