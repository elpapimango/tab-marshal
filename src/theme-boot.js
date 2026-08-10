/*
 * Applies the last resolved theme before the page paints.
 *
 * popup.js is a module, so it runs deferred — long enough for a dark-theme user
 * to see a white flash. This is a classic script in <head> so it runs
 * synchronously, and it only reads a value popup.js already resolved and
 * cached; the real theme logic lives in lib/theme.js.
 */
try {
  var cached = localStorage.getItem('tabSorterTheme');
  if (cached) document.documentElement.dataset.theme = cached;
} catch (e) {
  /* storage unavailable — the CSS falls back to prefers-color-scheme */
}
