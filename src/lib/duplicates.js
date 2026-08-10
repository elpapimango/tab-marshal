/**
 * Duplicate detection. Pure code — takes tab-like objects, returns which tabs
 * are duplicates and which one to keep.
 */

import { parseUrl, stripWww } from './keys.js';
import { TAB_GROUP_ID_NONE } from './sorter.js';

export const MATCH_MODES = [
  { id: 'exact', label: 'Exact URL' },
  { id: 'ignore-hash', label: 'Ignore #fragment' },
  { id: 'ignore-query', label: 'Ignore #fragment and ?query' },
  { id: 'host-path', label: 'Same host + path (ignore scheme)' }
];

export const DEFAULT_DUPLICATE_OPTIONS = {
  /** 'exact' | 'ignore-hash' | 'ignore-query' | 'host-path' */
  matchMode: 'ignore-hash',
  ignoreWww: true,
  ignoreTrailingSlash: true,
  /** Skip new-tab / blank pages, which are duplicates of each other by nature. */
  ignoreBlank: true,
  /** 'first' | 'last' | 'mru' */
  keep: 'first',
  protectPinned: true,
  protectGrouped: false,
  protectAudible: true
};

const BLANK_URLS = new Set([
  '',
  'about:blank',
  'about:newtab',
  'about:newtab#',
  'edge://newtab/',
  'chrome://newtab/',
  'edge://new-tab-page/'
]);

export function isBlankUrl(url) {
  if (!url) return true;
  const u = url.trim().toLowerCase();
  return BLANK_URLS.has(u) || u.startsWith('edge://newtab') || u.startsWith('chrome://newtab');
}

/** Canonical string two tabs must share to count as duplicates. */
export function normalizeUrl(url, opts = DEFAULT_DUPLICATE_OPTIONS) {
  if (!url) return '';
  const u = parseUrl(url);
  if (!u) return url.trim().toLowerCase();

  let host = u.hostname.toLowerCase();
  if (opts.ignoreWww) host = stripWww(host);

  let path = u.pathname || '';
  if (opts.ignoreTrailingSlash && path.length > 1) path = path.replace(/\/+$/, '');

  const port = u.port && u.port !== '80' && u.port !== '443' ? `:${u.port}` : '';

  switch (opts.matchMode) {
    case 'host-path':
      return `${host}${port}${path}`;
    case 'ignore-query':
      return `${u.protocol}//${host}${port}${path}`;
    case 'ignore-hash':
      return `${u.protocol}//${host}${port}${path}${u.search}`;
    case 'exact':
    default:
      return `${u.protocol}//${host}${port}${path}${u.search}${u.hash}`;
  }
}

export function isProtectedTab(tab, options = {}) {
  const opts = { ...DEFAULT_DUPLICATE_OPTIONS, ...options };
  if (opts.protectPinned && tab.pinned) return true;
  if (opts.protectGrouped && (tab.groupId ?? TAB_GROUP_ID_NONE) !== TAB_GROUP_ID_NONE) return true;
  if (opts.protectAudible && tab.audible) return true;
  return false;
}

function pickKeeper(tabs, opts) {
  // A protected tab is never closed, so if the set contains one it becomes the
  // keeper and everything else in the set is a candidate for closing.
  const protectedTabs = tabs.filter((t) => isProtectedTab(t, opts));
  const pool = protectedTabs.length ? protectedTabs : tabs;

  switch (opts.keep) {
    case 'last':
      return pool[pool.length - 1];
    case 'mru': {
      let best = pool[0];
      for (const t of pool) {
        const a = typeof t.lastAccessed === 'number' ? t.lastAccessed : -1;
        const b = typeof best.lastAccessed === 'number' ? best.lastAccessed : -1;
        if (a > b || (a === b && t.active)) best = t;
      }
      return best;
    }
    case 'first':
    default:
      return pool[0];
  }
}

/**
 * Group tabs by canonical URL and decide what to close.
 *
 * @param {Array} tabs   tab-like objects (any number of windows)
 * @param {object} options see DEFAULT_DUPLICATE_OPTIONS
 * @returns {{sets: Array<{key: string, keep: object, close: Array}>, closeIds: number[], closeCount: number}}
 */
export function findDuplicates(tabs, options = {}) {
  const opts = { ...DEFAULT_DUPLICATE_OPTIONS, ...options };
  const ordered = [...tabs].sort(
    (a, b) => (a.windowId ?? 0) - (b.windowId ?? 0) || (a.index ?? 0) - (b.index ?? 0)
  );

  const buckets = new Map();
  for (const tab of ordered) {
    if (opts.ignoreBlank && isBlankUrl(tab.url)) continue;
    const key = normalizeUrl(tab.url, opts);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(tab);
  }

  const sets = [];
  const closeIds = [];
  for (const [key, group] of buckets) {
    if (group.length < 2) continue;
    const keeper = pickKeeper(group, opts);
    const close = group.filter((t) => t.id !== keeper.id && !isProtectedTab(t, opts));
    if (!close.length) continue;
    sets.push({ key, keep: keeper, close });
    closeIds.push(...close.map((t) => t.id));
  }

  sets.sort((a, b) => b.close.length - a.close.length || a.key.localeCompare(b.key));
  return { sets, closeIds, closeCount: closeIds.length };
}
