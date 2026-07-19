(function applyInitialTheme() {
  try {
    var settings = JSON.parse(localStorage.getItem('app-settings') || '{}');
    var theme = (settings.appearance && settings.appearance.theme) || 'system';
    var isDark = theme === 'dark'
      || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    if (isDark) {
      root.setAttribute('data-theme', 'dark');
      root.style.setProperty('--bg-primary', '#2D2D2B');
      root.style.setProperty('--bg-secondary', '#252523');
    } else {
      root.style.setProperty('--bg-primary', '#F9F9F7');
      root.style.setProperty('--bg-secondary', '#EFEAE3');
    }
  } catch {
    // ThemeInjector will apply the validated setting once React starts.
  }
})();
