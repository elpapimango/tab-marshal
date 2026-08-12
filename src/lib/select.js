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

/**
 * Sources for the Select panel, which highlights tabs and then gets out of the
 * way. "active" is missing on purpose — selecting a single tab is what clicking
 * it already does — and "duplicates" is here instead, resolved by the caller
 * since it needs the duplicate-matching settings.
 */
export const SELECT_SOURCES = [
  { id: 'filter', label: 'Tabs matching a filter' },
  { id: 'all', label: 'All tabs' },
  { id: 'group', label: "The active tab's group" },
  { id: 'duplicates', label: 'Duplicate tabs (the extra copies)' }
];

export const DEFAULT_SELECT_OPTIONS = {
  /** 'filter' | 'all' | 'group' | 'duplicates' */
  selection: 'filter',
  field: 'domain',
  mode: 'contains',
  value: '',
  caseSensitive: false,
  /** Select everything the filter does NOT match. */
  negate: false,
  skipPinned: false,
  /** Unlike reloading, selecting a sleeping tab costs nothing. */
  skipUnloaded: false
};

function withCompiledFilter(opts) {
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

/** Compile the filter once; throws a readable error on a bad pattern. */
export function prepareReloadOptions(options) {
  if (options && options.__prepared) return options;
  return withCompiledFilter({ ...DEFAULT_RELOAD_OPTIONS, ...options, __prepared: true });
}

/** Same, for the Select panel's own defaults. */
export function prepareSelectOptions(options) {
  if (options && options.__prepared) return options;
  return withCompiledFilter({ ...DEFAULT_SELECT_OPTIONS, ...options, __prepared: true });
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

  if (opts.mode === 'regex') {
    // No pattern means no selection — inverting nothing must not become
    // "everything", which would be a very expensive misunderstanding.
    if (!opts.compiledFilter) return false;
    return flip(opts.compiledFilter.test(haystack), opts);
  }

  if (!opts.value) return false; // an empty filter matches nothing, never everything

  const a = opts.caseSensitive ? haystack : haystack.toLowerCase();
  const b = opts.caseSensitive ? opts.value : opts.value.toLowerCase();
  switch (opts.mode) {
    case 'equals':
      return flip(a === b, opts);
    case 'starts':
      return flip(a.startsWith(b), opts);
    case 'contains':
    default:
      return flip(a.includes(b), opts);
  }
}

/** `negate` turns the filter into "everything that does not match". */
function flip(hit, opts) {
  return opts.negate ? !hit : hit;
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

  if (opts.selection === 'duplicates') {
    // Needs the duplicate-matching settings, which this module deliberately
    // knows nothing about; apply.js resolves it before calling here.
    return [];
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
  if (opts.selection === 'filter' && opts.negate) return 'Every tab matches, so nothing is left over.';
  if (opts.selection === 'duplicates') return 'No duplicate tabs in this window.';
  return 'No tabs match.';
}
