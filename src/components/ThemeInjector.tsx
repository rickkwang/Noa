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
      root.style.setProperty('--bg-primary', '#1C1A17');
      root.style.setProperty('--bg-secondary', '#252219');
      root.style.setProperty('--text-primary', '#E8E0D0');
      root.style.setProperty('--text-secondary', '#9A9080');
      root.style.setProperty('--border-primary', '#3D3828');
    } else {
      root.style.setProperty('--bg-primary', '#EAE8E0');
      root.style.setProperty('--bg-secondary', '#DCD9CE');
      root.style.setProperty('--text-primary', '#2D2D2D');
      root.style.setProperty('--text-secondary', 'rgba(45, 45, 45, 0.5)');
      root.style.setProperty('--border-primary', '#2D2D2D');
    }

    const accentColors: Record<string, string> = {
      gold: '#B89B5E',
      blue: '#4A90E2',
      green: '#50E3C2',
      purple: '#9013FE',
      red: '#D0021B',
    };

    const accentColor = accentColors[settings.appearance.accentColor] ?? settings.appearance.accentColor ?? '#B89B5E';
    root.style.setProperty('--accent-color', accentColor);
  }, [isDark, settings.appearance.accentColor]);

  const fontFamilyStyle = settings.appearance.fontFamily === 'font-redaction' ? '"Redaction 50", serif' :
                          settings.appearance.fontFamily === 'font-pixelify' ? '"Pixelify Sans", sans-serif' :
                          settings.appearance.fontFamily === 'font-work-sans' ? '"Work Sans", sans-serif' :
                          settings.appearance.fontFamily;

  return (
    <style>{`
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

      /* Text Colors */
      .text-\\[\\#2D2D2D\\] { color: var(--text-primary) !important; }
      .text-\\[\\#B89B5E\\] { color: var(--accent-color) !important; }
      .text-\\[\\#2D2D2D\\]\\/50 { color: var(--text-secondary) !important; }
      .text-\\[\\#2D2D2D\\]\\/60 { color: color-mix(in srgb, var(--text-primary) 60%, transparent) !important; }
      .text-\\[\\#2D2D2D\\]\\/70 { color: color-mix(in srgb, var(--text-primary) 70%, transparent) !important; }
      .hover\\:text-\\[\\#B89B5E\\]:hover { color: var(--accent-color) !important; }
      .hover\\:text-\\[\\#2D2D2D\\]:hover { color: var(--text-primary) !important; }
      .group-hover\\:text-\\[\\#B89B5E\\]:hover { color: var(--accent-color) !important; }

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

      /* Prose (Markdown) overrides */
      .prose-a\\:text-\\[\\#B89B5E\\] a { color: var(--accent-color) !important; }
      .prose-pre\\:bg-\\[\\#DCD9CE\\] pre { background-color: var(--bg-secondary) !important; }
      .prose-pre\\:text-\\[\\#2D2D2D\\] pre { color: var(--text-primary) !important; }
      .prose-pre\\:border-\\[\\#2D2D2D\\] pre { border-color: var(--border-primary) !important; }
      .prose-code\\:text-\\[\\#B89B5E\\] code { color: var(--accent-color) !important; }
      .prose-code\\:bg-\\[\\#DCD9CE\\]\\/50 code { background-color: color-mix(in srgb, var(--bg-secondary) 50%, transparent) !important; }

      /* Font Family Override */
      .font-redaction {
        font-family: ${fontFamilyStyle} !important;
      }

      body {
        background-color: var(--bg-primary);
        color: var(--text-primary);
        font-family: ${fontFamilyStyle} !important;
      }
    `}</style>
  );
}
