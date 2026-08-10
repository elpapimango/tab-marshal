import { DEFAULT_SORT_OPTIONS } from './sorter.js';
import { DEFAULT_DUPLICATE_OPTIONS } from './duplicates.js';
import { DEFAULT_RELOAD_OPTIONS } from './select.js';

const KEY = 'tabSorterSettings';

export const DEFAULT_SETTINGS = {
  /** 'window' | 'all' — which windows an action applies to. */
  scope: 'window',
  sort: { ...DEFAULT_SORT_OPTIONS },
  duplicates: { ...DEFAULT_DUPLICATE_OPTIONS },
  reload: { ...DEFAULT_RELOAD_OPTIONS }
};

export async function loadSettings() {
  const stored = await chrome.storage.sync.get(KEY);
  const saved = stored[KEY] || {};
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    sort: { ...DEFAULT_SORT_OPTIONS, ...(saved.sort || {}) },
    duplicates: { ...DEFAULT_DUPLICATE_OPTIONS, ...(saved.duplicates || {}) },
    reload: { ...DEFAULT_RELOAD_OPTIONS, ...(saved.reload || {}) }
  };
}

export async function saveSettings(settings) {
  const clean = {
    scope: settings.scope,
    sort: { ...settings.sort },
    duplicates: { ...settings.duplicates },
    reload: { ...settings.reload }
  };
  // Never persist compiled RegExps — they are not structured-cloneable.
  delete clean.sort.compiledRegex;
  delete clean.sort.__prepared;
  delete clean.reload.compiledFilter;
  delete clean.reload.__prepared;
  await chrome.storage.sync.set({ [KEY]: clean });
}
