/**
 * What to do when a newly opened tab turns out to duplicate an open one.
 *
 * Pure code: it takes the new tab, the tabs it might duplicate, and returns a
 * plan. Nothing here closes anything — apply.js does that — which keeps the
 * decisions (including the safety rails) unit testable.
 */

import { isBlankUrl, isProtectedTab, normalizeUrl, DEFAULT_DUPLICATE_OPTIONS } from './duplicates.js';

export const DUPLICATE_ACTIONS = [
  { id: 'ignore', label: 'Nothing — allow duplicates' },
  { id: 'close-new', label: 'Close the new tab' },
  { id: 'close-old', label: 'Close the old tab, keep the new' },
  { id: 'focus-old', label: 'Switch to the old tab, close the new' },
  { id: 'focus-old-reload', label: 'Switch to the old tab, reload, close the new' }
];

export const DEFAULT_WATCH_OPTIONS = {
  /** A DUPLICATE_ACTIONS id. Off by default — this closes tabs on its own. */
  onDuplicate: 'ignore'
};

const NOTHING = Object.freeze({
  matched: false,
  oldTabId: null,
  closeTabIds: [],
  focusTabId: null,
  focusWindowId: null,
  reloadTabId: null,
  skipped: null
});

function result(fields) {
  return { ...NOTHING, ...fields };
}

/**
 * @param {object} newTab    the tab that just opened, with its committed URL
 * @param {Array}  otherTabs every other tab in scope
 * @param {object} options   { onDuplicate, match } — `match` is DEFAULT_DUPLICATE_OPTIONS-shaped
 * @param {object} context   { windowTabCount } tabs in the new tab's window, including it
 */
export function planDuplicateResponse(newTab, otherTabs, options = {}, context = {}) {
  const action = options.onDuplicate || DEFAULT_WATCH_OPTIONS.onDuplicate;
  if (action === 'ignore') return NOTHING;
  if (!newTab || isBlankUrl(newTab.url)) return NOTHING;

  const match = { ...DEFAULT_DUPLICATE_OPTIONS, ...(options.match || {}) };
  const key = normalizeUrl(newTab.url, match);
  if (!key) return NOTHING;

  const matches = otherTabs
    .filter((t) => t.id !== newTab.id && !isBlankUrl(t.url) && normalizeUrl(t.url, match) === key)
    .sort(byProximityTo(newTab));
  if (!matches.length) return NOTHING;

  const old = matches[0];

  if (action === 'close-old') {
    // Never close a tab the duplicate settings protect; if every match is
    // protected, leave both tabs alone rather than closing the new one
    // instead — silently doing the opposite of what was asked is worse than
    // doing nothing.
    const closable = matches.find((t) => !isProtectedTab(t, match));
    if (!closable) return result({ matched: true, oldTabId: old.id, skipped: 'protected' });
    return result({ matched: true, oldTabId: closable.id, closeTabIds: [closable.id] });
  }

  // Everything else closes the new tab. Closing the only tab in a window
  // closes the window, which is a bigger surprise than a stray duplicate.
  const soleTabInWindow = (context.windowTabCount ?? 0) <= 1;
  const closeTabIds = soleTabInWindow ? [] : [newTab.id];
  const skipped = soleTabInWindow ? 'sole-tab' : null;

  if (action === 'close-new') {
    return result({ matched: true, oldTabId: old.id, closeTabIds, skipped });
  }
  if (action === 'focus-old' || action === 'focus-old-reload') {
    return result({
      matched: true,
      oldTabId: old.id,
      closeTabIds,
      skipped,
      focusTabId: old.id,
      focusWindowId: old.windowId ?? null,
      reloadTabId: action === 'focus-old-reload' ? old.id : null
    });
  }
  return NOTHING;
}

/** Prefer a duplicate in the same window, then the leftmost one. */
function byProximityTo(newTab) {
  return (a, b) => {
    const aSame = a.windowId === newTab.windowId ? 0 : 1;
    const bSame = b.windowId === newTab.windowId ? 0 : 1;
    if (aSame !== bSame) return aSame - bSame;
    return (a.windowId ?? 0) - (b.windowId ?? 0) || (a.index ?? 0) - (b.index ?? 0);
  };
}

/** True when the plan would actually change something. */
export function planDoesSomething(plan) {
  return Boolean(plan.closeTabIds.length || plan.focusTabId || plan.reloadTabId);
}
