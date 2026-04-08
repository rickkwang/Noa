import React, { useEffect } from 'react';
import { AppSettings } from '../types';
import { useIsDark } from '../hooks/useIsDark';

interface ThemeInjectorProps {
  settings: AppSettings;
}

export default function ThemeInjector({ settings }: ThemeInjectorProps) {
  const isDark = useIsDark(settings.appearance.theme);

  useEffect(() => {
    const root = document.documentElement;

    if (isDark) {
      root.style.setProperty('--bg-primary', '#0F0F0F');
      root.style.setProperty('--bg-secondary', '#1A1A1A');
      root.style.setProperty('--text-primary', '#F5F0EB');
      root.style.setProperty('--text-secondary', 'rgba(245,240,235,0.5)');
      // Solid borders stay subtle; transparent-opacity variants are overridden separately in CSS
      root.style.setProperty('--border-primary', '#3A3A3A');
    } else {
      root.style.setProperty('--bg-primary', '#EAE8E0');
      root.style.setProperty('--bg-secondary', '#DCD9CE');
      root.style.setProperty('--text-primary', '#2D2D2D');
      root.style.setProperty('--text-secondary', 'rgba(45,45,45,0.5)');
      root.style.setProperty('--border-primary', '#2D2D2D');
    }

    const accentColors: Record<string, { light: string; dark: string }> = {
      gold:   { light: '#B89B5E', dark: '#DA7756' },
      blue:   { light: '#4A90E2', dark: '#5B9BD5' },
      green:  { light: '#50E3C2', dark: '#4CAF8A' },
      purple: { light: '#9013FE', dark: '#9B7FD4' },
      red:    { light: '#D0021B', dark: '#D45555' },
    };

    const palette = accentColors[settings.appearance.accentColor];
    const accentColor = palette
      ? (isDark ? palette.dark : palette.light)
      : (settings.appearance.accentColor ?? '#B89B5E');
    root.style.setProperty('--accent-color', accentColor);
  }, [isDark, settings.appearance.accentColor]);

  const fontFamilyStyle = settings.appearance.fontFamily === 'font-redaction' ? '"Redaction 50", serif' :
                          settings.appearance.fontFamily === 'font-pixelify' ? '"Pixelify Sans", sans-serif' :
                          settings.appearance.fontFamily === 'font-work-sans' ? '"Work Sans", sans-serif' :
                          settings.appearance.fontFamily;

  // In dark mode, #2D2D2D-based text/border/bg classes must be remapped to
  // light equivalents. We cover every opacity variant used in the codebase.
  const darkOverrides = isDark ? `
    /* ── Text: #2D2D2D → #F5F0EB (all opacity variants) ── */
    .text-\\[\\#2D2D2D\\]\\/10 { color: rgba(245,240,235,0.10) !important; }
    .text-\\[\\#2D2D2D\\]\\/20 { color: rgba(245,240,235,0.20) !important; }
    .text-\\[\\#2D2D2D\\]\\/30 { color: rgba(245,240,235,0.30) !important; }
    .text-\\[\\#2D2D2D\\]\\/35 { color: rgba(245,240,235,0.35) !important; }
    .text-\\[\\#2D2D2D\\]\\/40 { color: rgba(245,240,235,0.40) !important; }
    .text-\\[\\#2D2D2D\\]\\/50 { color: rgba(245,240,235,0.50) !important; }
    .text-\\[\\#2D2D2D\\]\\/60 { color: rgba(245,240,235,0.60) !important; }
    .text-\\[\\#2D2D2D\\]\\/70 { color: rgba(245,240,235,0.70) !important; }
    .text-\\[\\#2D2D2D\\]\\/80 { color: rgba(245,240,235,0.80) !important; }
    .text-\\[\\#2D2D2D\\]\\/90 { color: rgba(245,240,235,0.90) !important; }

    /* ── Hover text ── */
    .hover\\:text-\\[\\#2D2D2D\\]:hover { color: var(--text-primary) !important; }
    .hover\\:text-\\[\\#2D2D2D\\]\\/70:hover { color: rgba(245,240,235,0.70) !important; }

    /* ── Border: #2D2D2D → #F5F0EB (all opacity variants) ── */
    .border-\\[\\#2D2D2D\\]\\/10 { border-color: rgba(245,240,235,0.10) !important; }
    .border-\\[\\#2D2D2D\\]\\/15 { border-color: rgba(245,240,235,0.15) !important; }
    .border-\\[\\#2D2D2D\\]\\/20 { border-color: rgba(245,240,235,0.20) !important; }
    .border-\\[\\#2D2D2D\\]\\/30 { border-color: rgba(245,240,235,0.30) !important; }
    .border-\\[\\#2D2D2D\\]\\/40 { border-color: rgba(245,240,235,0.40) !important; }
    .border-\\[\\#2D2D2D\\]\\/90 { border-color: rgba(245,240,235,0.90) !important; }

    /* ── Background: #2D2D2D-based → light equivalent ── */
    .bg-\\[\\#2D2D2D\\]\\/10 { background-color: rgba(245,240,235,0.08) !important; }
    .bg-\\[\\#2D2D2D\\]\\/20 { background-color: rgba(245,240,235,0.12) !important; }

    /* ── Skeleton / pulse: remap from near-invisible to visible ── */
    .animate-pulse.bg-\\[\\#2D2D2D\\]\\/10,
    .bg-\\[\\#2D2D2D\\]\\/10.animate-pulse { background-color: rgba(245,240,235,0.07) !important; }

    /* ── Placeholder text ── */
    .placeholder-\\[\\#2D2D2D\\]\\/40::placeholder { color: rgba(245,240,235,0.35) !important; }
    .placeholder-\\[\\#2D2D2D\\]\\/50::placeholder { color: rgba(245,240,235,0.40) !important; }

    /* ── Divider lines (bg used as line) ── */
    .bg-\\[\\#2D2D2D\\]\\/20 { background-color: rgba(245,240,235,0.12) !important; }
  ` : '';

  return (
    <style>{`
      /* ════════════════════════════════════════
         Shared overrides (always active)
         ════════════════════════════════════════ */

      /* Backgrounds */
      .bg-\\[\\#EAE8E0\\] { background-color: var(--bg-primary) !important; }
      .bg-\\[\\#DCD9CE\\] { background-color: var(--bg-secondary) !important; }
      .bg-\\[\\#B89B5E\\] { background-color: var(--accent-color) !important; }
      .hover\\:bg-\\[\\#DCD9CE\\]\\/50:hover { background-color: color-mix(in srgb, var(--bg-secondary) 50%, transparent) !important; }
      .hover\\:bg-\\[\\#DCD9CE\\]\\/30:hover { background-color: color-mix(in srgb, var(--bg-secondary) 30%, transparent) !important; }
      .bg-\\[\\#DCD9CE\\]\\/30 { background-color: color-mix(in srgb, var(--bg-secondary) 30%, transparent) !important; }
      .bg-\\[\\#DCD9CE\\]\\/50 { background-color: color-mix(in srgb, var(--bg-secondary) 50%, transparent) !important; }
      .bg-\\[\\#B89B5E\\]\\/10 { background-color: color-mix(in srgb, var(--accent-color) 10%, transparent) !important; }
      .bg-\\[\\#EAE8E0\\]\\/50 { background-color: color-mix(in srgb, var(--bg-primary) 50%, transparent) !important; }

      /* Text */
      .text-\\[\\#2D2D2D\\] { color: var(--text-primary) !important; }
      .text-\\[\\#B89B5E\\] { color: var(--accent-color) !important; }
      .text-\\[\\#2D2D2D\\]\\/50 { color: color-mix(in srgb, var(--text-primary) 50%, transparent) !important; }
      .text-\\[\\#2D2D2D\\]\\/60 { color: color-mix(in srgb, var(--text-primary) 60%, transparent) !important; }
      .text-\\[\\#2D2D2D\\]\\/70 { color: color-mix(in srgb, var(--text-primary) 70%, transparent) !important; }
      .hover\\:text-\\[\\#B89B5E\\]:hover { color: var(--accent-color) !important; }
      .hover\\:text-\\[\\#2D2D2D\\]:hover { color: var(--text-primary) !important; }
      .group-hover\\:text-\\[\\#B89B5E\\] { color: inherit; }
      .group:hover .group-hover\\:text-\\[\\#B89B5E\\] { color: var(--accent-color) !important; }

      /* Borders */
      .border-\\[\\#2D2D2D\\] { border-color: var(--border-primary) !important; }
      .border-\\[\\#B89B5E\\] { border-color: var(--accent-color) !important; }
      .border-\\[\\#2D2D2D\\]\\/20 { border-color: color-mix(in srgb, var(--border-primary) 20%, transparent) !important; }
      .border-\\[\\#2D2D2D\\]\\/10 { border-color: color-mix(in srgb, var(--border-primary) 10%, transparent) !important; }
      .hover\\:border-\\[\\#2D2D2D\\]:hover { border-color: var(--border-primary) !important; }
      .hover\\:border-\\[\\#B89B5E\\]:hover { border-color: var(--accent-color) !important; }

      /* Shadows */
      .shadow-\\[8px_8px_0px_0px_rgba\\(45\\,45\\,45\\,1\\)\\] { box-shadow: 8px 8px 0px 0px var(--border-primary) !important; }
      .shadow-\\[4px_4px_0px_0px_rgba\\(45\\,45\\,45\\,1\\)\\] { box-shadow: 4px 4px 0px 0px var(--border-primary) !important; }
      .shadow-\\[2px_2px_0px_0px_rgba\\(45\\,45\\,45\\,1\\)\\] { box-shadow: 2px 2px 0px 0px var(--border-primary) !important; }
      .shadow-\\[4px_4px_0_0_rgba\\(45\\,45\\,45\\,1\\)\\] { box-shadow: 4px 4px 0px 0px var(--border-primary) !important; }
      .shadow-\\[inset_4px_0px_0px_0px_\\#B89B5E\\] { box-shadow: inset 4px 0px 0px 0px var(--accent-color) !important; }
      .shadow-\\[inset_2px_2px_0px_0px_rgba\\(0\\,0\\,0\\,0\\.2\\)\\] { box-shadow: inset 2px 2px 0px 0px rgba(0,0,0,0.2) !important; }

      /* Selection */
      .selection\\:bg-\\[\\#B89B5E\\] *::selection { background-color: var(--accent-color) !important; }
      .selection\\:bg-\\[\\#B89B5E\\]::selection { background-color: var(--accent-color) !important; }

      /* Prose (Markdown) */
      .prose-a\\:text-\\[\\#B89B5E\\] a { color: var(--accent-color) !important; }
      .prose-pre\\:bg-\\[\\#DCD9CE\\] pre { background-color: var(--bg-secondary) !important; }
      .prose-pre\\:text-\\[\\#2D2D2D\\] pre { color: var(--text-primary) !important; }
      .prose-pre\\:border-\\[\\#2D2D2D\\] pre { border-color: var(--border-primary) !important; }
      .prose-code\\:text-\\[\\#B89B5E\\] code { color: var(--accent-color) !important; }
      .prose-code\\:bg-\\[\\#DCD9CE\\]\\/50 code { background-color: color-mix(in srgb, var(--bg-secondary) 50%, transparent) !important; }

      /* Font */
      .font-redaction { font-family: ${fontFamilyStyle} !important; }
      body {
        background-color: var(--bg-primary);
        color: var(--text-primary);
        font-family: ${fontFamilyStyle} !important;
      }

      /* ════════════════════════════════════════
         Dark-mode-only overrides
         ════════════════════════════════════════ */
      ${darkOverrides}
    `}</style>
  );
}
