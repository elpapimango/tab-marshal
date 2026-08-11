/**
 * The browser-API side of things: read the current window state, run the pure
 * planner, then move tabs and groups into place.
 */

import { api, hasTabGroups } from './browser.js';
import { planSort, planFromSnapshot, prepareOptions, TAB_GROUP_ID_NONE } from './sorter.js';
import { findDuplicates } from './duplicates.js';
import { selectTabs, explainEmpty, prepareReloadOptions, prepareSelectOptions } from './select.js';
import { planDuplicateResponse, planDoesSomething } from './watch.js';

const UNDO_KEY = 'undoSnapshots';

async function getWindowIds(scope) {
  if (scope === 'all') {
    const windows = await api.windows.getAll({ windowTypes: ['normal'] });
    return windows.map((w) => w.id);
  }
  const win = await api.windows.getCurrent();
  return [win.id];
}

async function readWindow(windowId) {
  const tabs = await api.tabs.query({ windowId });
  const groups = hasTabGroups() ? await api.tabGroups.query({ windowId }) : [];
  return { tabs: tabs.sort((a, b) => a.index - b.index), groups };
}

/**
 * Apply a plan by walking the strip left to right with a cursor. Everything to
 * the left of the cursor is already final, so a move never disturbs placed
 * tabs, and group members are only ever rearranged inside their own range —
 * which is what keeps groups contiguous.
 */
async function applyPlan(plan) {
  let cursor = 0;
  let moves = 0;

  for (const tabId of plan.pinned) {
    await moveTab(tabId, cursor++);
    moves++;
  }

  for (const block of plan.blocks) {
    if (block.kind === 'tab') {
      await moveTab(block.tabId, cursor);
      cursor += 1;
      moves++;
      continue;
    }
    if (hasTabGroups()) {
      try {
        await api.tabGroups.move(block.groupId, { index: cursor });
      } catch {
        // The group may have been dissolved between reading and applying;
        // moving the member tabs below still produces the right order.
      }
    }
    for (let i = 0; i < block.tabIds.length; i++) {
      await moveTab(block.tabIds[i], cursor + i);
      moves++;
    }
    cursor += block.tabIds.length;
  }
  return moves;
}

async function moveTab(tabId, index) {
  try {
    await api.tabs.move(tabId, { index });
  } catch {
    // Tab closed mid-sort, or the user is dragging a tab right now. Skip it.
  }
}

async function saveUndoSnapshot(windowId, tabs) {
  const snapshot = tabs.map((t) => ({
    id: t.id,
    index: t.index,
    pinned: t.pinned,
    groupId: t.groupId ?? TAB_GROUP_ID_NONE
  }));
  const store = (await api.storage.session.get(UNDO_KEY))[UNDO_KEY] || {};
  store[windowId] = { savedAt: Date.now(), snapshot };
  await api.storage.session.set({ [UNDO_KEY]: store });
}

/** Sort every window in scope. Returns a short human-readable summary. */
export async function sortTabs(settings) {
  const opts = prepareOptions(settings.sort);
  const windowIds = await getWindowIds(settings.scope);
  let tabCount = 0;

  for (const windowId of windowIds) {
    const { tabs, groups } = await readWindow(windowId);
    if (tabs.length < 2) continue;
    await saveUndoSnapshot(windowId, tabs);
    const plan = planSort(tabs, groups, opts);
    await applyPlan(plan);
    tabCount += tabs.length;
  }

  const windowLabel = windowIds.length === 1 ? 'window' : `${windowIds.length} windows`;
  return { ok: true, message: `Sorted ${tabCount} ${plural(tabCount, 'tab')} in ${windowLabel}.` };
}

/** Restore the tab order captured before the most recent sort. */
export async function undoSort(settings) {
  const store = (await api.storage.session.get(UNDO_KEY))[UNDO_KEY] || {};
  const windowIds = (await getWindowIds(settings.scope)).filter((id) => store[id]);
  if (!windowIds.length) return { ok: false, message: 'Nothing to undo.' };

  for (const windowId of windowIds) {
    const { snapshot } = store[windowId];
    const live = await api.tabs.query({ windowId });
    const liveIds = new Set(live.map((t) => t.id));
    const restorable = snapshot.filter((t) => liveIds.has(t.id));
    await applyPlan(planFromSnapshot(restorable));
    delete store[windowId];
  }
  await api.storage.session.set({ [UNDO_KEY]: store });
  return { ok: true, message: 'Restored the previous tab order.' };
}

export async function hasUndo(settings) {
  const store = (await api.storage.session.get(UNDO_KEY))[UNDO_KEY] || {};
  const windowIds = await getWindowIds(settings.scope);
  return windowIds.some((id) => store[id]);
}

async function queryScopedTabs(scope) {
  if (scope === 'all') return api.tabs.query({ windowType: 'normal' });
  const win = await api.windows.getCurrent();
  return api.tabs.query({ windowId: win.id });
}

/** Find duplicates without touching anything. */
export async function previewDuplicates(settings) {
  const tabs = await queryScopedTabs(settings.scope);
  return findDuplicates(tabs, settings.duplicates);
}

/** Find duplicates and close them. */
export async function closeDuplicates(settings) {
  const { closeIds, closeCount } = await previewDuplicates(settings);
  if (!closeCount) return { ok: true, closed: 0, message: 'No duplicate tabs found.' };
  await api.tabs.remove(closeIds);
  return {
    ok: true,
    closed: closeCount,
    message: `Closed ${closeCount} duplicate ${plural(closeCount, 'tab')}.`
  };
}

/**
 * Selection is always anchored to the current window's active tab, even when
 * the scope is all windows — "the active tab's group" has to mean one group.
 */
async function reloadContext() {
  const [active] = await api.tabs.query({ active: true, currentWindow: true });
  return {
    activeTabId: active ? active.id : undefined,
    activeGroupId: active ? active.groupId ?? TAB_GROUP_ID_NONE : TAB_GROUP_ID_NONE
  };
}

/** Which tabs a reload would hit, without touching anything. */
export async function previewReload(settings) {
  const opts = prepareReloadOptions(settings.reload);
  // "The active tab" and its group are window-local regardless of scope.
  const scope = opts.selection === 'active' || opts.selection === 'group' ? 'window' : settings.scope;
  const tabs = await queryScopedTabs(scope);
  const context = await reloadContext();
  const selected = selectTabs(tabs, opts, context);
  return {
    tabs: selected,
    count: selected.length,
    reason: selected.length ? '' : explainEmpty(opts, context)
  };
}

/**
 * Reload the selected tabs, optionally staggered so a big batch does not hit
 * the network all at once. Tabs the browser refuses to reload (some internal
 * pages) are counted as skipped rather than failing the whole run.
 */
export async function reloadTabs(settings) {
  const opts = prepareReloadOptions(settings.reload);
  const { tabs, count, reason } = await previewReload(settings);
  if (!count) return { ok: false, reloaded: 0, message: reason };

  let reloaded = 0;
  let skipped = 0;
  for (let i = 0; i < tabs.length; i++) {
    try {
      await api.tabs.reload(tabs[i].id, { bypassCache: !!opts.bypassCache });
      reloaded++;
    } catch {
      skipped++;
    }
    if (opts.delayMs > 0 && i < tabs.length - 1) await sleep(opts.delayMs);
  }

  const hard = opts.bypassCache ? ' (cache bypassed)' : '';
  const tail = skipped ? `, ${skipped} skipped` : '';
  return {
    ok: true,
    reloaded,
    message: `Reloaded ${reloaded} ${plural(reloaded, 'tab')}${hard}${tail}.`
  };
}

/**
 * Which tabs the Select panel would highlight.
 *
 * Always one window: multi-select is a per-window notion, and `tabs.highlight`
 * makes its first entry active, so spanning windows would yank the focused tab
 * in every one of them.
 */
export async function previewSelection(settings) {
  const opts = prepareSelectOptions(settings.select);
  const win = await api.windows.getCurrent();
  const tabs = await api.tabs.query({ windowId: win.id });
  const context = await reloadContext();

  let chosen;
  if (opts.selection === 'duplicates') {
    const ids = new Set(findDuplicates(tabs, settings.duplicates).closeIds);
    chosen = tabs.filter((t) => ids.has(t.id));
  } else {
    chosen = selectTabs(tabs, opts, context);
  }

  return {
    windowId: win.id,
    tabs: chosen,
    count: chosen.length,
    reason: chosen.length ? '' : explainEmpty(opts, context)
  };
}

/** Highlight the selection in the tab strip, changing nothing else. */
export async function applySelection(settings) {
  const { windowId, tabs, count, reason } = await previewSelection(settings);
  if (!count) return { ok: false, selected: 0, message: reason };

  // highlight() takes indices, not ids, and makes the first one active. Leading
  // with the already-active tab when it is part of the set keeps the focus
  // where the user left it.
  const active = tabs.find((t) => t.active);
  const ordered = active ? [active, ...tabs.filter((t) => t !== active)] : tabs;

  await api.tabs.highlight({ windowId, tabs: ordered.map((t) => t.index), populate: false });
  return {
    ok: true,
    selected: count,
    message: `Selected ${count} ${plural(count, 'tab')}.`
  };
}

/**
 * Duplicate the active tab.
 *
 * Firefox has no built-in shortcut for this, which is the only reason the
 * command exists; the API itself works everywhere.
 */
export async function duplicateActiveTab() {
  const [active] = await api.tabs.query({ active: true, currentWindow: true });
  if (!active) return { ok: false, message: 'No active tab to duplicate.' };
  await api.tabs.duplicate(active.id);
  return { ok: true, message: 'Duplicated the active tab.' };
}

/**
 * Decide and carry out what happens when a freshly opened tab duplicates one
 * that is already open. Called from the service worker for each new tab's first
 * committed URL; a no-op unless the user picked an action.
 */
export async function respondToNewTab(tab, settings) {
  const action = (settings.watch && settings.watch.onDuplicate) || 'ignore';
  if (action === 'ignore' || !tab || typeof tab.id !== 'number') return { acted: false };

  // Popup windows opened by web apps are not part of the tab strip the user
  // manages, so leave them alone.
  try {
    const win = await api.windows.get(tab.windowId);
    if (win.type !== 'normal') return { acted: false };
  } catch {
    return { acted: false };
  }

  const scoped =
    settings.scope === 'window'
      ? await api.tabs.query({ windowId: tab.windowId })
      : await api.tabs.query({ windowType: 'normal' });

  const windowTabCount = scoped.filter((t) => t.windowId === tab.windowId).length;
  const plan = planDuplicateResponse(
    tab,
    scoped.filter((t) => t.id !== tab.id),
    { onDuplicate: action, match: settings.duplicates },
    { windowTabCount }
  );
  if (!planDoesSomething(plan)) return { acted: false, plan };

  // Focus before closing so the strip never flashes an unrelated tab.
  if (plan.focusTabId) {
    try {
      await api.tabs.update(plan.focusTabId, { active: true });
      if (plan.focusWindowId != null) await api.windows.update(plan.focusWindowId, { focused: true });
    } catch {
      /* the old tab vanished between the query and now */
    }
  }
  if (plan.reloadTabId) {
    try {
      await api.tabs.reload(plan.reloadTabId);
    } catch {
      /* not reloadable */
    }
  }
  if (plan.closeTabIds.length) {
    try {
      await api.tabs.remove(plan.closeTabIds);
    } catch {
      /* already closed */
    }
  }
  return { acted: true, plan };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function plural(n, word) {
  return n === 1 ? word : `${word}s`;
}
