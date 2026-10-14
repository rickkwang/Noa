(function applyInitialTheme() {
  try {
    var settings = JSON.parse(localStorage.getItem('app-settings') || '{}');
    var theme = (settings.appearance && settings.appearance.theme) || 'system';
    var isDark = theme === 'dark'
      || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    if (isDark) {
      root.setAttribute('data-theme', 'dark');
      root.style.setProperty('--bg-primary', '#262624');
      root.style.setProperty('--bg-secondary', '#1E1E1C');
      root.style.backgroundColor = '#262624';
    } else {
      root.style.setProperty('--bg-primary', '#FCFCFB');
      root.style.setProperty('--bg-secondary', '#F9F9F7');
      root.style.backgroundColor = '#FCFCFB';
    }
  } catch {
    // ThemeInjector will apply the validated setting once React starts.
  }
})();
