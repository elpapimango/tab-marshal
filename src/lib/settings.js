import { api } from './browser.js';
import { DEFAULT_SORT_OPTIONS } from './sorter.js';
import { DEFAULT_DUPLICATE_OPTIONS } from './duplicates.js';
import { DEFAULT_RELOAD_OPTIONS, DEFAULT_SELECT_OPTIONS } from './select.js';
import { DEFAULT_WATCH_OPTIONS } from './watch.js';
import { DEFAULT_THEME } from './theme.js';

const KEY = 'tabSorterSettings';

export const DEFAULT_SETTINGS = {
  /** 'window' | 'all' — which windows an action applies to. */
  scope: 'window',
  /** A THEMES id from lib/theme.js. */
  theme: DEFAULT_THEME,
  sort: { ...DEFAULT_SORT_OPTIONS },
  duplicates: { ...DEFAULT_DUPLICATE_OPTIONS },
  reload: { ...DEFAULT_RELOAD_OPTIONS },
  select: { ...DEFAULT_SELECT_OPTIONS },
  watch: { ...DEFAULT_WATCH_OPTIONS }
};

export async function loadSettings() {
  const stored = await api.storage.sync.get(KEY);
  const saved = stored[KEY] || {};
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    sort: { ...DEFAULT_SORT_OPTIONS, ...(saved.sort || {}) },
    duplicates: { ...DEFAULT_DUPLICATE_OPTIONS, ...(saved.duplicates || {}) },
    reload: { ...DEFAULT_RELOAD_OPTIONS, ...(saved.reload || {}) },
    select: { ...DEFAULT_SELECT_OPTIONS, ...(saved.select || {}) },
    watch: { ...DEFAULT_WATCH_OPTIONS, ...(saved.watch || {}) }
  };
}

export async function saveSettings(settings) {
  const clean = {
    scope: settings.scope,
    theme: settings.theme,
    sort: { ...settings.sort },
    duplicates: { ...settings.duplicates },
    reload: { ...settings.reload },
    select: { ...settings.select },
    watch: { ...settings.watch }
  };
  // Never persist compiled RegExps — they are not structured-cloneable.
  delete clean.sort.compiledRegex;
  delete clean.sort.__prepared;
  delete clean.reload.compiledFilter;
  delete clean.reload.__prepared;
  delete clean.select.compiledFilter;
  delete clean.select.__prepared;
  await api.storage.sync.set({ [KEY]: clean });
}
