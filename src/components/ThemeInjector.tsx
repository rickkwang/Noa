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
      root.style.setProperty('--bg-primary', '#262624');
      root.style.setProperty('--bg-secondary', '#1E1E1C');
      root.style.setProperty('--text-primary', '#F0EDE6');
      root.style.setProperty('--text-secondary', 'rgba(240,237,230,0.5)');
      root.style.setProperty('--border-primary', '#3A3A37');
    } else {
      root.removeAttribute('data-theme');
      root.style.setProperty('--bg-primary', '#EAE8E0');
      root.style.setProperty('--bg-secondary', '#DCD9CE');
      root.style.setProperty('--text-primary', '#2D2D2D');
      root.style.setProperty('--text-secondary', 'rgba(45,45,45,0.5)');
      root.style.setProperty('--border-primary', '#2D2D2D');
    }

    const accentColors: Record<string, { light: string; dark: string }> = {
      gold:   { light: '#B89B5E', dark: '#D97757' },
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

  return (
    <style>{`
      /* CSS variable-based overrides — work in both light and dark */
      .bg-\\[\\#EAE8E0\\]     { background-color: var(--bg-primary) !important; }
      .bg-\\[\\#DCD9CE\\]     { background-color: var(--bg-secondary) !important; }
      .bg-\\[\\#B89B5E\\]     { background-color: var(--accent-color) !important; }
      .bg-\\[\\#EAE8E0\\]\\/50 { background-color: color-mix(in srgb, var(--bg-primary) 50%, transparent) !important; }
      .bg-\\[\\#DCD9CE\\]\\/30 { background-color: color-mix(in srgb, var(--bg-secondary) 30%, transparent) !important; }
      .bg-\\[\\#DCD9CE\\]\\/50 { background-color: color-mix(in srgb, var(--bg-secondary) 50%, transparent) !important; }
      .bg-\\[\\#B89B5E\\]\\/10 { background-color: color-mix(in srgb, var(--accent-color) 10%, transparent) !important; }

      .text-\\[\\#2D2D2D\\]     { color: var(--text-primary) !important; }
      .text-\\[\\#B89B5E\\]     { color: var(--accent-color) !important; }
      .text-\\[\\#2D2D2D\\]\\/50 { color: color-mix(in srgb, var(--text-primary) 50%, transparent) !important; }
      .text-\\[\\#2D2D2D\\]\\/60 { color: color-mix(in srgb, var(--text-primary) 60%, transparent) !important; }
      .text-\\[\\#2D2D2D\\]\\/70 { color: color-mix(in srgb, var(--text-primary) 70%, transparent) !important; }
      .hover\\:text-\\[\\#B89B5E\\]:hover { color: var(--accent-color) !important; }
      .hover\\:text-\\[\\#2D2D2D\\]:hover { color: var(--text-primary) !important; }
      .group:hover .group-hover\\:text-\\[\\#B89B5E\\] { color: var(--accent-color) !important; }

      .border-\\[\\#2D2D2D\\]      { border-color: var(--border-primary) !important; }
      .border-\\[\\#B89B5E\\]      { border-color: var(--accent-color) !important; }
      .border-\\[\\#2D2D2D\\]\\/10 { border-color: color-mix(in srgb, var(--border-primary) 10%, transparent) !important; }
      .border-\\[\\#2D2D2D\\]\\/20 { border-color: color-mix(in srgb, var(--border-primary) 20%, transparent) !important; }
      .border-\\[\\#2D2D2D\\]\\/30 { border-color: color-mix(in srgb, var(--border-primary) 30%, transparent) !important; }
      .border-\\[\\#2D2D2D\\]\\/40 { border-color: color-mix(in srgb, var(--border-primary) 40%, transparent) !important; }
      .border-\\[\\#2D2D2D\\]\\/50 { border-color: color-mix(in srgb, var(--border-primary) 50%, transparent) !important; }
      .hover\\:border-\\[\\#2D2D2D\\]:hover { border-color: var(--border-primary) !important; }
      .hover\\:border-\\[\\#B89B5E\\]:hover  { border-color: var(--accent-color) !important; }
      .focus\\:border-\\[\\#B89B5E\\]:focus  { border-color: var(--accent-color) !important; }
      .border-\\[\\#B89B5E\\]\\/50 { border-color: color-mix(in srgb, var(--accent-color) 50%, transparent) !important; }
      .border-\\[\\#B89B5E\\]\\/60 { border-color: color-mix(in srgb, var(--accent-color) 60%, transparent) !important; }

      .shadow-\\[8px_8px_0px_0px_rgba\\(45\\,45\\,45\\,1\\)\\] { box-shadow: 8px 8px 0px 0px var(--border-primary) !important; }
      .shadow-\\[4px_4px_0px_0px_rgba\\(45\\,45\\,45\\,1\\)\\] { box-shadow: 4px 4px 0px 0px var(--border-primary) !important; }
      .shadow-\\[2px_2px_0px_0px_rgba\\(45\\,45\\,45\\,1\\)\\] { box-shadow: 2px 2px 0px 0px var(--border-primary) !important; }
      .shadow-\\[4px_4px_0_0_rgba\\(45\\,45\\,45\\,1\\)\\]     { box-shadow: 4px 4px 0px 0px var(--border-primary) !important; }
      .shadow-\\[inset_4px_0px_0px_0px_\\#B89B5E\\]          { box-shadow: inset 4px 0px 0px 0px var(--accent-color) !important; }

      .selection\\:bg-\\[\\#B89B5E\\] *::selection { background-color: color-mix(in srgb, var(--accent-color) 40%, transparent) !important; }
      .selection\\:bg-\\[\\#B89B5E\\]::selection   { background-color: color-mix(in srgb, var(--accent-color) 40%, transparent) !important; }

      .prose-a\\:text-\\[\\#B89B5E\\] a         { color: var(--accent-color) !important; }
      .prose-pre\\:bg-\\[\\#DCD9CE\\] pre        { background-color: var(--bg-secondary) !important; }
      .prose-pre\\:text-\\[\\#2D2D2D\\] pre      { color: var(--text-primary) !important; }
      .prose-code\\:text-\\[\\#B89B5E\\] code    { color: var(--accent-color) !important; }
      .prose-code\\:bg-\\[\\#DCD9CE\\]\\/50 code { background-color: color-mix(in srgb, var(--bg-secondary) 50%, transparent) !important; }

      .font-redaction { font-family: ${fontFamilyStyle} !important; }
      body {
        background-color: var(--bg-primary);
        color: var(--text-primary);
        font-family: ${fontFamilyStyle} !important;
      }
    `}</style>
  );
}
