import { useState, useEffect } from 'react';
import { AppSettings } from '../types';

export function useIsDark(theme: AppSettings['appearance']['theme']): boolean {
  const getIsDark = () =>
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const [isDark, setIsDark] = useState(getIsDark);

  useEffect(() => {
    setIsDark(getIsDark());
    if (theme !== 'system') return;

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
    // getIsDark is a render-local closure; adding it would re-run this effect
    // on every render. We deliberately re-read it via setIsDark(getIsDark())
    // only when theme changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  return isDark;
}
