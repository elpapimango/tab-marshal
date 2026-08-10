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
  { id: 'ctp-mocha', label: 'Mocha', group: 'Catppuccin' },
  { id: 'nord-auto', label: 'Match browser (Snow Storm / Polar Night)', group: 'Nord' },
  { id: 'nord-light', label: 'Snow Storm', group: 'Nord' },
  { id: 'nord', label: 'Polar Night', group: 'Nord' },
  { id: 'dracula-auto', label: 'Match browser (Alucard / Dracula)', group: 'Dracula' },
  { id: 'alucard', label: 'Alucard', group: 'Dracula' },
  { id: 'dracula', label: 'Dracula', group: 'Dracula' }
];

/** The palettes popup.css actually implements. */
export const CONCRETE_THEMES = [
  'light',
  'dark',
  'ctp-latte',
  'ctp-frappe',
  'ctp-macchiato',
  'ctp-mocha',
  'nord',
  'nord-light',
  'dracula',
  'alucard'
];

/** Auto choice -> [light palette, dark palette]. */
const AUTO_PAIRS = {
  'ctp-auto': ['ctp-latte', 'ctp-mocha'],
  'nord-auto': ['nord-light', 'nord'],
  'dracula-auto': ['alucard', 'dracula'],
  system: ['light', 'dark']
};

export const DEFAULT_THEME = 'system';

/**
 * @param {string} choice      a THEMES id
 * @param {boolean} prefersDark whether the browser reports a dark colour scheme
 * @returns {string} a CONCRETE_THEMES id, safe to use as [data-theme]
 */
export function resolveTheme(choice, prefersDark) {
  if (CONCRETE_THEMES.includes(choice)) return choice;
  // 'system', plus anything unrecognised from an older or newer version.
  const [light, dark] = AUTO_PAIRS[choice] || AUTO_PAIRS.system;
  return prefersDark ? dark : light;
}
