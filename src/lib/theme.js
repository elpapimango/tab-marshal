/**
 * Theme choices. Pure code — the "auto" variants are resolved to a concrete
 * palette here rather than in CSS, so popup.css needs one plain block per
 * palette and no duplicated media queries.
 */

export const THEMES = [
  { id: 'system', label: 'Match browser', group: 'Default' },
  { id: 'light', label: 'Light', group: 'Default' },
  { id: 'dark', label: 'Dark', group: 'Default' },
  // Spelled out because the collapsed <select> shows no optgroup context.
  { id: 'ctp-auto', label: 'Match browser (Latte / Mocha)', group: 'Catppuccin' },
  { id: 'ctp-latte', label: 'Latte', group: 'Catppuccin' },
  { id: 'ctp-frappe', label: 'Frappé', group: 'Catppuccin' },
  { id: 'ctp-macchiato', label: 'Macchiato', group: 'Catppuccin' },
  { id: 'ctp-mocha', label: 'Mocha', group: 'Catppuccin' }
];

/** The palettes popup.css actually implements. */
export const CONCRETE_THEMES = ['light', 'dark', 'ctp-latte', 'ctp-frappe', 'ctp-macchiato', 'ctp-mocha'];

export const DEFAULT_THEME = 'system';

/**
 * @param {string} choice      a THEMES id
 * @param {boolean} prefersDark whether the browser reports a dark colour scheme
 * @returns {string} a CONCRETE_THEMES id, safe to use as [data-theme]
 */
export function resolveTheme(choice, prefersDark) {
  if (CONCRETE_THEMES.includes(choice)) return choice;
  if (choice === 'ctp-auto') return prefersDark ? 'ctp-mocha' : 'ctp-latte';
  // 'system', plus anything unrecognised from an older or newer version.
  return prefersDark ? 'dark' : 'light';
}
