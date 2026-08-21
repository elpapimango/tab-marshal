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
  // Mirrors lib/theme.js CONCRETE_THEMES — this classic script has to run
  // synchronously before paint, so it cannot import the module that owns the
  // canonical list. An id popup.css no longer implements is left unstyled
  // rather than applied, so the popup falls back to prefers-color-scheme
  // instead of showing a broken [data-theme].
  var CONCRETE_THEMES = ['light', 'dark', 'ctp-latte', 'ctp-frappe', 'ctp-macchiato', 'ctp-mocha', 'nord', 'nord-light', 'dracula', 'alucard'];
  if (cached && CONCRETE_THEMES.indexOf(cached) !== -1) document.documentElement.dataset.theme = cached;
} catch (e) {
  /* storage unavailable — the CSS falls back to prefers-color-scheme */
}
