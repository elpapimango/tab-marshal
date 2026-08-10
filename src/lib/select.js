/**
 * Picking a subset of tabs to act on. Pure code — no `chrome` access.
 *
 * Used by the reload action, but deliberately generic: the selection model is
 * "which tabs", not "which tabs to reload".
 */

import { getDomain, getHostname, getHostPath } from './keys.js';
import { TAB_GROUP_ID_NONE } from './sorter.js';

export const SELECTIONS = [
  { id: 'active', label: 'The active tab' },
  { id: 'all', label: 'All tabs' },
  { id: 'group', label: "The active tab's group" },
  { id: 'filter', label: 'Tabs matching a filter' }
];

export const FILTER_FIELDS = [
  { id: 'domain', label: 'Domain' },
  { id: 'hostname', label: 'Hostname' },
  { id: 'url', label: 'URL' },
  { id: 'path', label: 'Host + path' },
  { id: 'title', label: 'Title' }
];

export const FILTER_MODES = [
  { id: 'contains', label: 'contains' },
  { id: 'equals', label: 'is exactly' },
  { id: 'starts', label: 'starts with' },
  { id: 'regex', label: 'matches regex' }
];

export const DEFAULT_RELOAD_OPTIONS = {
  /** 'active' | 'all' | 'group' | 'filter' */
  selection: 'all',
  field: 'domain',
  mode: 'contains',
  value: '',
  caseSensitive: false,
  /** Hard reload, ignoring the HTTP cache. */
  bypassCache: false,
  skipPinned: false,
  /** Leave sleeping/discarded tabs asleep instead of waking them all up. */
  skipUnloaded: true,
  /** Pause between reloads so a big batch doesn't hit the network at once. */
  delayMs: 100
};

/** Compile the filter once; throws a readable error on a bad pattern. */
export function prepareReloadOptions(options) {
  if (options && options.__prepared) return options;
  const opts = { ...DEFAULT_RELOAD_OPTIONS, ...options, __prepared: true };
  if (opts.selection === 'filter' && opts.mode === 'regex') {
    if (!opts.value) throw new Error('Enter a pattern to match.');
    try {
      opts.compiledFilter = new RegExp(opts.value, opts.caseSensitive ? '' : 'i');
    } catch (err) {
      throw new Error(String(err.message).replace(/^SyntaxError:\s*/, ''));
    }
  }
  return opts;
}

/** The value a filter is tested against. */
export function fieldValue(tab, field) {
  switch (field) {
    case 'domain':
      return getDomain(tab.url);
    case 'hostname':
      return getHostname(tab.url);
    case 'path':
      return getHostPath(tab.url);
    case 'title':
      return tab.title || '';
    case 'url':
    default:
      return tab.url || '';
  }
}

export function matchesFilter(tab, opts) {
  const haystack = fieldValue(tab, opts.field);
  if (opts.mode === 'regex') return opts.compiledFilter ? opts.compiledFilter.test(haystack) : false;

  if (!opts.value) return false; // an empty filter matches nothing, never everything
  const a = opts.caseSensitive ? haystack : haystack.toLowerCase();
  const b = opts.caseSensitive ? opts.value : opts.value.toLowerCase();
  switch (opts.mode) {
    case 'equals':
      return a === b;
    case 'starts':
      return a.startsWith(b);
    case 'contains':
    default:
      return a.includes(b);
  }
}

/**
 * @param {Array} tabs      candidate tabs (already limited to the chosen scope)
 * @param {object} options  see DEFAULT_RELOAD_OPTIONS
 * @param {object} context  { activeTabId, activeGroupId } from the current window
 */
export function selectTabs(tabs, options, context = {}) {
  const opts = prepareReloadOptions(options);

  if (opts.selection === 'active') {
    // An explicit "this tab" never gets filtered out by the skip options.
    return tabs.filter((t) => t.id === context.activeTabId);
  }

  let list = tabs;
  if (opts.selection === 'group') {
    const gid = context.activeGroupId;
    list = gid === undefined || gid === TAB_GROUP_ID_NONE ? [] : list.filter((t) => t.groupId === gid);
  } else if (opts.selection === 'filter') {
    list = list.filter((t) => matchesFilter(t, opts));
  }

  if (opts.skipPinned) list = list.filter((t) => !t.pinned);
  if (opts.skipUnloaded) list = list.filter((t) => !t.discarded && t.status !== 'unloaded');
  return list;
}

/** Explains an empty selection, so the UI can say why nothing matched. */
export function explainEmpty(options, context = {}) {
  const opts = { ...DEFAULT_RELOAD_OPTIONS, ...options };
  if (opts.selection === 'group') {
    const gid = context.activeGroupId;
    if (gid === undefined || gid === TAB_GROUP_ID_NONE) return 'The active tab is not in a tab group.';
  }
  if (opts.selection === 'filter' && !opts.value) return 'Enter a value to filter on.';
  return 'No tabs match.';
}
