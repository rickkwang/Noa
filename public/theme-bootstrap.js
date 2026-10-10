(function applyInitialTheme() {
  try {
    var settings = JSON.parse(localStorage.getItem('app-settings') || '{}');
    var theme = (settings.appearance && settings.appearance.theme) || 'system';
    var isDark = theme === 'dark'
      || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    if (isDark) {
      root.setAttribute('data-theme', 'dark');
      root.style.setProperty('--bg-primary', '#2A2A28');
      root.style.setProperty('--bg-secondary', '#222220');
      root.style.backgroundColor = '#2A2A28';
    } else {
      root.style.setProperty('--bg-primary', '#FCFCFB');
      root.style.setProperty('--bg-secondary', '#EFEAE3');
      root.style.backgroundColor = '#FCFCFB';
    }
  } catch {
    // ThemeInjector will apply the validated setting once React starts.
  }
})();
