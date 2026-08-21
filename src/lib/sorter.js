/**
 * Sorting logic. Pure code — it takes plain tab/group objects and returns a
 * *plan* describing the desired final arrangement. Applying that plan through
 * the chrome.* APIs lives in apply.js, which keeps this file unit testable.
 */

import { clampForMatch, getDomain, getHostname, getHostPath, parseUrl } from './keys.js';

export const TAB_GROUP_ID_NONE = -1;

export const CRITERIA = [
  { id: 'domain', label: 'Domain (example.co.uk)' },
  { id: 'hostname', label: 'Hostname (www.example.co.uk)' },
  { id: 'url', label: 'Full URL' },
  { id: 'path', label: 'Host + path' },
  { id: 'title', label: 'Tab title' },
  { id: 'lastAccessed', label: 'Last accessed' },
  { id: 'regex', label: 'Regular expression' }
];

/** Order used when sorting groups by colour; also the fixed tabGroups colour enum. */
export const COLOR_ORDER = ['grey', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'pink', 'purple'];

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Compile the regular expression once so the comparator does not rebuild it for
 * every comparison. Throws a readable error on an invalid pattern.
 */
export function prepareOptions(options) {
  if (options && options.__prepared) return options;
  const opts = { ...DEFAULT_SORT_OPTIONS, ...options, __prepared: true };
  if (opts.primary === 'regex' || opts.secondary === 'regex') {
    if (!opts.regexPattern) throw new Error('Enter a regular expression first.');
    let flags = 'u';
    if (opts.regexIgnoreCase) flags += 'i';
    try {
      opts.compiledRegex = new RegExp(opts.regexPattern, flags);
    } catch {
      // `u` mode rejects some otherwise-valid legacy patterns; retry without it.
      try {
        opts.compiledRegex = new RegExp(opts.regexPattern, opts.regexIgnoreCase ? 'i' : '');
      } catch (err) {
        // The engine's own message already names the pattern and the problem.
        throw new Error(String(err.message).replace(/^SyntaxError:\s*/, ''));
      }
    }
  }
  return opts;
}

export const DEFAULT_SORT_OPTIONS = {
  primary: 'domain',
  secondary: 'title',
  descending: false,
  /** 'all' | 'inside-groups' | 'ungrouped' */
  target: 'all',
  /** 'interleave' | 'first' | 'last' */
  groupPlacement: 'interleave',
  /** 'tabs' | 'title' | 'color' | 'size' */
  groupOrderBy: 'tabs',
  regexPattern: '',
  regexIgnoreCase: true,
  /** 'url' | 'title' */
  regexSource: 'url'
};

/**
 * Sort key for one tab. Returns a string, a number, or null when the tab has no
 * value for this criterion (an unmatched regex). Null keys always sort last.
 */
export function tabKey(tab, criterion, opts = {}) {
  switch (criterion) {
    case 'domain':
      return getDomain(tab.url);
    case 'hostname':
      return getHostname(tab.url);
    case 'url':
      return tab.url || '';
    case 'path':
      return getHostPath(tab.url);
    case 'title':
      return tab.title || parseUrl(tab.url)?.hostname || '';
    case 'lastAccessed':
      // Most browsers expose lastAccessed; fall back to tab id (roughly creation order).
      return typeof tab.lastAccessed === 'number' ? tab.lastAccessed : tab.id || 0;
    case 'regex':
      return regexKey(tab, opts);
    case 'none':
      return null;
    default:
      return '';
  }
}

function regexKey(tab, opts) {
  const source = opts.regexSource === 'title' ? tab.title || '' : tab.url || '';
  if (!opts.compiledRegex) return null;
  // Clamped because a sort can be triggered from the context menu, which runs in
  // the service worker, against a title the page chose.
  const m = clampForMatch(source).match(opts.compiledRegex);
  if (!m) return null;
  // A capture group lets the user pick out just the part to sort on.
  return m[1] !== undefined ? m[1] : m[0];
}

/** Compare two sort keys. Null (no value) always goes last, regardless of direction. */
export function compareKeys(a, b) {
  const aNull = a === null || a === undefined || a === '';
  const bNull = b === null || b === undefined || b === '';
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

/**
 * Compare two keys in the requested direction. Missing keys always end up last,
 * so reversing the sort does not drag unmatched tabs to the front.
 */
export function compareKeysDirectional(a, b, dir) {
  const aMissing = isMissing(a);
  const bMissing = isMissing(b);
  if (aMissing || bMissing) {
    if (aMissing && bMissing) return 0;
    return aMissing ? 1 : -1;
  }
  return compareKeys(a, b) * dir;
}

/**
 * Memoised tabKey(), for one sort run.
 *
 * A comparison sort asks for the same tab's key O(log n) times over, and the
 * URL-derived criteria are not cheap — 'domain' builds a URL object and then
 * walks the suffix list. Keys are computed once per tab per criterion instead,
 * held against the tab object itself, which turns thousands of URL parses on a
 * busy window back into one per tab.
 *
 * Valid only as long as the tabs are not mutated mid-sort, which is exactly the
 * lifetime of a single planSort().
 */
export function makeKeyCache(opts) {
  const byCriterion = new Map();
  return (tab, criterion) => {
    let keys = byCriterion.get(criterion);
    if (!keys) {
      keys = new Map();
      byCriterion.set(criterion, keys);
    }
    if (!keys.has(tab)) keys.set(tab, tabKey(tab, criterion, opts));
    return keys.get(tab);
  };
}

/**
 * Comparator over tabs honouring primary/secondary criteria and direction.
 *
 * @param {Function} [keyOf] a makeKeyCache() lookup to share with the caller, so
 *   block ordering and member ordering do not each key the same tabs again.
 */
export function makeTabComparator(opts, keyOf = makeKeyCache(opts)) {
  const dir = opts.descending ? -1 : 1;
  return (t1, t2) => {
    const r = compareKeysDirectional(keyOf(t1, opts.primary), keyOf(t2, opts.primary), dir);
    if (r !== 0) return r;
    if (opts.secondary && opts.secondary !== 'none' && opts.secondary !== opts.primary) {
      // The secondary criterion always runs ascending, so "Z→A by domain, A→Z
      // by title" is expressible.
      const r2 = compareKeys(keyOf(t1, opts.secondary), keyOf(t2, opts.secondary));
      if (r2 !== 0) return r2;
    }
    return (t1.index ?? 0) - (t2.index ?? 0);
  };
}

function isMissing(k) {
  return k === null || k === undefined || k === '';
}

/**
 * Split a window's tabs into pinned tabs plus a list of blocks. A block is
 * either a single ungrouped tab or a whole tab group; tab groups have to stay
 * contiguous in the strip, so blocks are the unit that can be reordered.
 */
/** True when `tabs` is already in ascending index order. */
function isOrderedByIndex(tabs) {
  for (let i = 1; i < tabs.length; i++) {
    if (tabs[i].index < tabs[i - 1].index) return false;
  }
  return true;
}

export function splitIntoBlocks(tabs) {
  // apply.js's readWindow() already sorts by index before this ever runs; skip
  // the redundant sort rather than paying for it on every call.
  const ordered = isOrderedByIndex(tabs) ? tabs : [...tabs].sort((a, b) => a.index - b.index);
  const pinned = ordered.filter((t) => t.pinned);
  const rest = ordered.filter((t) => !t.pinned);

  const blocks = [];
  const byGroup = new Map();
  for (const tab of rest) {
    const gid = tab.groupId ?? TAB_GROUP_ID_NONE;
    if (gid === TAB_GROUP_ID_NONE) {
      blocks.push({ kind: 'tab', tabId: tab.id, tabs: [tab] });
      continue;
    }
    let block = byGroup.get(gid);
    if (!block) {
      block = { kind: 'group', groupId: gid, tabs: [] };
      byGroup.set(gid, block);
      blocks.push(block);
    }
    block.tabs.push(tab);
  }
  return { pinned, blocks };
}

/**
 * Build the target arrangement for one window.
 *
 * @param {Array} tabs   chrome.tabs.Tab-like objects for a single window
 * @param {Array} groups chrome.tabGroups.TabGroup-like objects for that window
 * @param {object} options see DEFAULT_SORT_OPTIONS (already run through prepareOptions)
 * @returns {{pinned: number[], blocks: Array}} plan consumable by applyPlan()
 */
export function planSort(tabs, groups, options) {
  const opts = prepareOptions(options);
  // One cache for the whole run: the pinned sort, each group's member sort and
  // the block ordering all ask about the same tabs.
  const keyOf = makeKeyCache(opts);
  const cmp = makeTabComparator(opts, keyOf);
  const groupsById = new Map((groups || []).map((g) => [g.id, g]));
  const { pinned, blocks } = splitIntoBlocks(tabs);

  // Pinned tabs live in their own region at the front of the strip and are only
  // ever sorted against each other.
  const pinnedOrder = opts.target === 'all' ? [...pinned].sort(cmp) : [...pinned];

  const sortInside = opts.target === 'all' || opts.target === 'inside-groups';
  for (const block of blocks) {
    if (block.kind === 'group' && sortInside) block.tabs = [...block.tabs].sort(cmp);
    block.repTab = block.tabs[0];
  }

  let orderedBlocks;
  if (opts.target === 'inside-groups') {
    orderedBlocks = blocks;
  } else if (opts.target === 'ungrouped') {
    orderedBlocks = reorderLoneTabsInPlace(blocks, cmp);
  } else {
    orderedBlocks = orderBlocks(blocks, groupsById, cmp, opts, keyOf);
  }

  return {
    pinned: pinnedOrder.map((t) => t.id),
    blocks: orderedBlocks.map((b) =>
      b.kind === 'group'
        ? { kind: 'group', groupId: b.groupId, tabIds: b.tabs.map((t) => t.id) }
        : { kind: 'tab', tabId: b.tabId }
    )
  };
}

/**
 * "Ungrouped tabs only": groups keep the slots they already occupy and the lone
 * tabs are sorted among the slots that were already theirs.
 */
function reorderLoneTabsInPlace(blocks, cmp) {
  const slots = [];
  const loneTabs = [];
  blocks.forEach((b, i) => {
    if (b.kind === 'tab') {
      slots.push(i);
      loneTabs.push(b);
    }
  });
  loneTabs.sort((a, b) => cmp(a.tabs[0], b.tabs[0]));
  const out = [...blocks];
  slots.forEach((slot, i) => {
    out[slot] = loneTabs[i];
  });
  return out;
}

function orderBlocks(blocks, groupsById, cmp, opts, keyOf) {
  const groupBlocks = blocks.filter((b) => b.kind === 'group');
  const tabBlocks = blocks.filter((b) => b.kind === 'tab');

  if (opts.groupPlacement === 'interleave') {
    const dir = opts.descending ? -1 : 1;
    return [...blocks].sort((a, b) => {
      const r = compareKeysDirectional(
        blockKey(a, groupsById, opts, keyOf),
        blockKey(b, groupsById, opts, keyOf),
        dir
      );
      if (r !== 0) return r;
      return cmp(a.repTab, b.repTab);
    });
  }

  const sortedGroups = sortGroupBlocks(groupBlocks, groupsById, cmp, opts);
  const sortedTabs = [...tabBlocks].sort((a, b) => cmp(a.tabs[0], b.tabs[0]));
  return opts.groupPlacement === 'first'
    ? [...sortedGroups, ...sortedTabs]
    : [...sortedTabs, ...sortedGroups];
}

function sortGroupBlocks(groupBlocks, groupsById, cmp, opts) {
  const dir = opts.descending ? -1 : 1;
  return [...groupBlocks].sort((a, b) => {
    if (opts.groupOrderBy === 'tabs') return cmp(a.repTab, b.repTab);
    const r = compareKeysDirectional(
      groupMetaKey(a, groupsById, opts),
      groupMetaKey(b, groupsById, opts),
      dir
    );
    if (r !== 0) return r;
    return cmp(a.repTab, b.repTab);
  });
}

/** Key used to position a block relative to other blocks. */
function blockKey(block, groupsById, opts, keyOf) {
  if (block.kind === 'tab') return keyOf(block.tabs[0], opts.primary);
  if (opts.groupOrderBy === 'tabs') return keyOf(block.repTab, opts.primary);
  return groupMetaKey(block, groupsById, opts);
}

function groupMetaKey(block, groupsById, opts) {
  const group = groupsById.get(block.groupId);
  switch (opts.groupOrderBy) {
    case 'title':
      return (group && group.title) || '￿'; // untitled groups last
    case 'color': {
      const idx = COLOR_ORDER.indexOf((group && group.color) || '');
      return idx === -1 ? COLOR_ORDER.length : idx;
    }
    case 'size':
      return block.tabs.length;
    default:
      return '';
  }
}

/**
 * Turn the current tab list into a plan that reproduces exactly this order.
 * Used to snapshot the strip before sorting so the sort can be undone.
 */
export function planFromSnapshot(snapshot) {
  const { pinned, blocks } = splitIntoBlocks(snapshot);
  return {
    pinned: pinned.map((t) => t.id),
    blocks: blocks.map((b) =>
      b.kind === 'group'
        ? { kind: 'group', groupId: b.groupId, tabIds: b.tabs.map((t) => t.id) }
        : { kind: 'tab', tabId: b.tabId }
    )
  };
}

/** Flatten a plan into the tab id order it describes (handy for tests). */
export function planToTabIds(plan) {
  const ids = [...plan.pinned];
  for (const b of plan.blocks) {
    if (b.kind === 'group') ids.push(...b.tabIds);
    else ids.push(b.tabId);
  }
  return ids;
}
