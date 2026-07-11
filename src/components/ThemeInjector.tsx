import React, { useLayoutEffect } from 'react';
import { AppSettings } from '../types';
import { useIsDark } from '../hooks/useIsDark';

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
      root.style.setProperty('--text-primary', '#F9F9F7');
      root.style.setProperty('--text-secondary', 'rgba(249,249,247,0.5)');
      root.style.setProperty('--border-primary', '#3A3A37');
    } else {
      root.removeAttribute('data-theme');
      root.style.setProperty('--bg-primary', '#F9F9F7');
      root.style.setProperty('--bg-secondary', '#EFEAE3');
      root.style.setProperty('--bg-tertiary', '#E5DCD2');
      root.style.setProperty('--text-primary', '#2D2D2B');
      root.style.setProperty('--text-secondary', 'rgba(45,45,43,0.55)');
      root.style.setProperty('--border-primary', '#2D2D2B');
    }

    // Accent is a fixed theme token (coral in both themes), not user-configurable.
    root.style.setProperty('--accent-color', '#CC7D5E');
    root.dataset.pointerCursors = settings.appearance.usePointerCursors ? 'enabled' : 'disabled';

    // Keep the native window background on the same token as --bg-primary —
    // macOS paints it at the window edges during live resize, and a mismatch
    // shows as light ghost bands along the frame in dark mode.
    void window.noaDesktop?.appearance?.setWindowBackgroundColor(isDark ? '#2D2D2B' : '#F9F9F7')
      ?.catch(() => { /* desktop-only; ignore if the bridge is unavailable */ });
  }, [isDark, settings.appearance.usePointerCursors]);

  const fontFamilyStyle = settings.appearance.fontFamily === 'font-iosevka' ? '"Iosevka Nerd Font Mono", "Iosevka NF", monospace' :
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

      .border-\\[\\#2D2D2B\\]      { border-color: var(--border-primary) !important; }
      .border-\\[\\#CC7D5E\\]      { border-color: var(--accent-color) !important; }
      .border-\\[\\#2D2D2B\\]\\/10 { border-color: color-mix(in srgb, var(--border-primary) 10%, transparent) !important; }
      .border-\\[\\#2D2D2B\\]\\/20 { border-color: color-mix(in srgb, var(--border-primary) 20%, transparent) !important; }
      .border-\\[\\#2D2D2B\\]\\/30 { border-color: color-mix(in srgb, var(--border-primary) 30%, transparent) !important; }
      .border-\\[\\#2D2D2B\\]\\/40 { border-color: color-mix(in srgb, var(--border-primary) 40%, transparent) !important; }
      .border-\\[\\#2D2D2B\\]\\/50 { border-color: color-mix(in srgb, var(--border-primary) 50%, transparent) !important; }
      .border-\\[\\#2D2D2B\\]\\/60 { border-color: color-mix(in srgb, var(--border-primary) 60%, transparent) !important; }
      .border-\\[\\#2D2D2B\\]\\/90 { border-color: color-mix(in srgb, var(--border-primary) 90%, transparent) !important; }
      .hover\\:border-\\[\\#2D2D2B\\]:hover { border-color: var(--border-primary) !important; }
      .hover\\:border-\\[\\#CC7D5E\\]:hover  { border-color: var(--accent-color) !important; }
      .focus\\:border-\\[\\#CC7D5E\\]:focus  { border-color: var(--accent-color) !important; }
      .border-\\[\\#CC7D5E\\]\\/50 { border-color: color-mix(in srgb, var(--accent-color) 50%, transparent) !important; }
      .border-\\[\\#CC7D5E\\]\\/60 { border-color: color-mix(in srgb, var(--accent-color) 60%, transparent) !important; }

      .shadow-\\[4px_4px_0_0_rgba\\(45\\,45\\,43\\,1\\)\\] { box-shadow: 4px 4px 0 0 var(--border-primary) !important; }
      .shadow-\\[2px_2px_0_0_rgba\\(45\\,45\\,43\\,1\\)\\] { box-shadow: 2px 2px 0 0 var(--border-primary) !important; }
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
