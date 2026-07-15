try {
  const theme = localStorage.getItem('binnacle:theme');
  const colors = { day: '#cfe0ec', dusk: '#0f1a24', 'night-red': '#000000' };
  if (theme && Object.hasOwn(colors, theme)) {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors[theme]);
  }
} catch {
  // Storage can be unavailable in private browsing. The day theme remains the safe default.
}
