/**
 * The browser-API side of things: read the current window state, run the pure
 * planner, then move tabs and groups into place.
 */

import { api, hasTabGroups } from './browser.js';
import { planSort, planFromSnapshot, prepareOptions, TAB_GROUP_ID_NONE } from './sorter.js';
import { findDuplicates } from './duplicates.js';
import { selectTabs, explainEmpty, prepareReloadOptions, prepareSelectOptions } from './select.js';
import { planDuplicateResponse, planDoesSomething } from './watch.js';
import { planGroupAssignments, DEFAULT_AUTOGROUP_OPTIONS } from './autogroup.js';

const UNDO_KEY = 'undoSnapshots';

async function getWindowIds(scope) {
  if (scope === 'all') {
    const windows = await api.windows.getAll({ windowTypes: ['normal'] });
    return windows.map((w) => w.id);
  }
  const win = await api.windows.getCurrent();
  return [win.id];
}

/**
 * Tabs the user can actually see.
 *
 * Zen keeps every space's tabs in one window and hides the ones belonging to
 * other spaces, so a hidden tab is somebody else's space (or a tab another
 * extension hid). Acting on it would reach outside the strip in front of the
 * user, so nothing here ever does. On a browser with no hidden tabs this is a
 * no-op, which is why it needs no Zen detection to be correct.
 */
function visible(tabs) {
  return tabs.filter((t) => t.hidden !== true);
}

async function readWindow(windowId) {
  const all = (await api.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
  const tabs = visible(all);
  const groups = hasTabGroups() ? await api.tabGroups.query({ windowId }) : [];
  // The strip positions those tabs occupy. Sorting reuses exactly these, so a
  // hidden tab keeps its place and other spaces keep their own order.
  return { tabs, groups, slots: tabs.map((t) => t.index), hidden: all.length - tabs.length };
}

/**
 * Apply a plan by walking the strip left to right with a cursor. Everything to
 * the left of the cursor is already final, so a move never disturbs placed
 * tabs, and group members are only ever rearranged inside their own range —
 * which is what keeps groups contiguous.
 */
async function applyPlan(plan, slots) {
  let step = 0;
  let moves = 0;
  // Without hidden tabs the slots are 0,1,2… and this is the plain cursor it
  // has always been. With them, the plan is poured back into the positions the
  // sortable tabs already held, so nothing lands on a hidden tab's slot.
  const nextSlot = () => (slots ? slots[step] : step);

  // Tabs bound for consecutive slots go in one call. `tabs.move` takes an array
  // and lands it at `index` in array order, which is exactly what the per-tab
  // loop used to spell out one round-trip at a time — and a round-trip per tab
  // is what makes a few hundred tabs visibly churn through the strip.
  const run = { ids: [], start: -1 };

  const flush = async () => {
    if (!run.ids.length) return;
    const { ids, start } = run;
    run.ids = [];
    run.start = -1;
    await moveTabs(ids, start);
  };

  const place = async (tabId) => {
    const slot = nextSlot();
    step++;
    moves++;
    // A gap in the slots — a hidden tab sitting between two sortable ones — ends
    // the run, since one call can only ever fill consecutive indices.
    if (run.ids.length && slot !== run.start + run.ids.length) await flush();
    if (!run.ids.length) run.start = slot;
    run.ids.push(tabId);
  };

  for (const tabId of plan.pinned) await place(tabId);
  // Pinned and unpinned tabs never share a call: the browser treats the two
  // regions of the strip as separate, and a move across the boundary is refused.
  await flush();

  for (const block of plan.blocks) {
    if (block.kind === 'tab') {
      await place(block.tabId);
      continue;
    }
    // The group has to be positioned before its members are arranged inside it,
    // so whatever is queued has to land first.
    await flush();
    const groupStart = nextSlot();
    if (hasTabGroups()) {
      try {
        await api.tabGroups.move(block.groupId, { index: groupStart });
      } catch {
        // The group may have been dissolved between reading and applying;
        // moving the member tabs below still produces the right order.
      }
    }
    for (const tabId of block.tabIds) await place(tabId);
    await flush();
  }
  await flush();
  return moves;
}

/**
 * Move a run of tabs onto consecutive indices starting at `index`.
 *
 * The batch form succeeds or fails as a unit, so one tab closing mid-sort would
 * take its whole run with it. The retry walks the run tab by tab — which is what
 * the loop here used to do for every tab, every time.
 */
async function moveTabs(ids, index) {
  if (ids.length === 1) return moveTab(ids[0], index);
  try {
    await api.tabs.move(ids, { index });
  } catch {
    for (let i = 0; i < ids.length; i++) await moveTab(ids[i], index + i);
  }
}

async function moveTab(tabId, index) {
  try {
    await api.tabs.move(tabId, { index });
  } catch {
    // Tab closed mid-sort, or the user is dragging a tab right now. Skip it.
  }
}

function snapshotOf(tabs) {
  return tabs.map((t) => ({
    id: t.id,
    index: t.index,
    pinned: t.pinned,
    groupId: t.groupId ?? TAB_GROUP_ID_NONE
  }));
}

async function readUndoStore() {
  return (await api.storage.session.get(UNDO_KEY))[UNDO_KEY] || {};
}

/**
 * Record where the tabs were, for every window about to be sorted, in one write.
 * Read-modify-writing the whole store per window made a sort across four windows
 * eight storage round-trips before a single tab had moved.
 */
async function saveUndoSnapshots(byWindowId) {
  const store = await readUndoStore();
  for (const [windowId, snapshot] of byWindowId) store[windowId] = { snapshot };
  await api.storage.session.set({ [UNDO_KEY]: store });
}

/** Sort every window in scope. Returns a short human-readable summary. */
export async function sortTabs(settings) {
  const opts = prepareOptions(settings.sort);
  const windowIds = await getWindowIds(settings.scope);

  // Every window is read before anything moves, so the snapshots can go out in
  // one write and still go out first — a sort interrupted half way has to stay
  // undoable.
  const jobs = [];
  for (const windowId of windowIds) {
    const state = await readWindow(windowId);
    if (state.tabs.length < 2) continue;
    jobs.push({ windowId, ...state });
  }
  if (!jobs.length) return { ok: false, message: 'Nothing to sort.' };

  await saveUndoSnapshots(new Map(jobs.map((job) => [job.windowId, snapshotOf(job.tabs)])));

  let tabCount = 0;
  for (const job of jobs) {
    await applyPlan(planSort(job.tabs, job.groups, opts), job.slots);
    tabCount += job.tabs.length;
  }

  const windowLabel = windowIds.length === 1 ? 'window' : `${windowIds.length} windows`;
  return { ok: true, message: `Sorted ${tabCount} ${plural(tabCount, 'tab')} in ${windowLabel}.` };
}

/** Restore the tab order captured before the most recent sort. */
export async function undoSort(settings) {
  const store = await readUndoStore();
  const windowIds = (await getWindowIds(settings.scope)).filter((id) => store[id]);
  if (!windowIds.length) return { ok: false, message: 'Nothing to undo.' };

  for (const windowId of windowIds) {
    const { snapshot } = store[windowId];
    const live = visible(await api.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
    const liveIds = new Set(live.map((t) => t.id));
    const restorable = snapshot.filter((t) => liveIds.has(t.id));
    const restorableIds = new Set(restorable.map((t) => t.id));
    // Put them back in the same slots they occupy now, for the same reason.
    const slots = live.filter((t) => restorableIds.has(t.id)).map((t) => t.index);
    await applyPlan(planFromSnapshot(restorable), slots);
    delete store[windowId];
  }
  await api.storage.session.set({ [UNDO_KEY]: store });
  return { ok: true, message: 'Restored the previous tab order.' };
}

export async function hasUndo(settings) {
  const store = await readUndoStore();
  const windowIds = await getWindowIds(settings.scope);
  return windowIds.some((id) => store[id]);
}

function groupsByTitle(groups) {
  return new Map(groups.map((g) => [String(g.title || '').toLowerCase(), g]));
}

/**
 * Carry out a planGroupAssignments() plan in one window. Tabs headed for the
 * same group are bucketed into a single tabs.group() call each, and a bucket
 * with no existing group creates one and names/colours it.
 *
 * @param {Map} byTitle mutated in place so a group created for one bucket is
 *   visible to the next call in the same run (e.g. two tabs, same new group).
 */
async function applyGroupPlan(windowId, plan, byTitle) {
  const buckets = new Map();
  for (const item of plan) {
    const key = item.groupTitle.toLowerCase();
    if (!buckets.has(key)) {
      buckets.set(key, { title: item.groupTitle, color: item.color, existingGroupId: item.existingGroupId, tabIds: [] });
    }
    buckets.get(key).tabIds.push(item.tabId);
  }

  let grouped = 0;
  let failed = 0;
  for (const bucket of buckets.values()) {
    try {
      if (bucket.existingGroupId != null) {
        await api.tabs.group({ tabIds: bucket.tabIds, groupId: bucket.existingGroupId });
      } else {
        const groupId = await api.tabs.group({ tabIds: bucket.tabIds, createProperties: { windowId } });
        await api.tabGroups.update(groupId, { title: bucket.title, color: bucket.color });
        byTitle.set(bucket.title.toLowerCase(), { id: groupId, title: bucket.title, color: bucket.color });
      }
      grouped += bucket.tabIds.length;
    } catch (err) {
      // A tab closed mid-run, or the group vanished between planning and now.
      // Counted rather than swallowed: "nothing matched your rules" and "the
      // grouping was refused" are different answers, and reporting the first
      // when the second happened sends the user off to edit working rules.
      failed += bucket.tabIds.length;
      console.warn('[Tab Marshal] group', bucket.title, err);
    }
  }
  return { grouped, failed };
}

/**
 * Group every eligible tab in scope by the saved rules — the "Group tabs now"
 * button and the group-tabs command. Reconciles all matching tabs at once;
 * tabs whose current group no longer matches any rule are left alone, since
 * Auto-Group should never undo grouping the user did by hand.
 */
export async function groupTabs(settings) {
  if (!hasTabGroups()) {
    return { ok: false, grouped: 0, message: "Tab groups aren't supported by this browser version." };
  }
  const opts = settings.autoGroup || DEFAULT_AUTOGROUP_OPTIONS;
  if (!opts.rules || !opts.rules.length) {
    return { ok: false, grouped: 0, message: 'Add a rule first.' };
  }

  const windowIds = await getWindowIds(settings.scope);
  let grouped = 0;
  let failed = 0;
  for (const windowId of windowIds) {
    const { tabs, groups } = await readWindow(windowId);
    const eligible = tabs.filter((t) => !t.pinned);
    const byTitle = groupsByTitle(groups);
    const plan = planGroupAssignments(eligible, opts.rules, byTitle);
    if (!plan.length) continue;
    const outcome = await applyGroupPlan(windowId, plan, byTitle);
    grouped += outcome.grouped;
    failed += outcome.failed;
  }

  if (!grouped) {
    return failed
      ? { ok: false, grouped: 0, message: `The browser refused to group ${failed} matching ${plural(failed, 'tab')}.` }
      : { ok: true, grouped: 0, message: 'No tabs matched a rule.' };
  }
  const tail = failed ? `, ${failed} refused` : '';
  return { ok: true, grouped, message: `Grouped ${grouped} ${plural(grouped, 'tab')}${tail}.` };
}

/**
 * Group a single freshly opened tab, called from the service worker. A no-op
 * unless auto-group is on, rules exist, and the tab isn't pinned.
 */
export async function applyAutoGroupTab(tab, settings) {
  if (!hasTabGroups() || !tab || typeof tab.id !== 'number' || tab.pinned) return { acted: false };

  const opts = settings.autoGroup || DEFAULT_AUTOGROUP_OPTIONS;
  if (!opts.enabled || !opts.rules || !opts.rules.length) return { acted: false };

  // A popup window opened by a web app is not part of the tab strip the user
  // manages, so it is left alone here for the same reason the duplicate watch
  // leaves it alone.
  if (!(await isNormalWindow(tab.windowId))) return { acted: false };

  const groups = await api.tabGroups.query({ windowId: tab.windowId });
  const byTitle = groupsByTitle(groups);
  const plan = planGroupAssignments([tab], opts.rules, byTitle);
  if (!plan.length) return { acted: false };

  const { grouped } = await applyGroupPlan(tab.windowId, plan, byTitle);
  return { acted: grouped > 0 };
}

/** False for a web app's popup window, and for a window that just went away. */
async function isNormalWindow(windowId) {
  try {
    const win = await api.windows.get(windowId);
    return win.type === 'normal';
  } catch {
    return false;
  }
}

async function queryScopedTabs(scope) {
  // The Duplicates and Reload panels come through here. Sorting and undo filter
  // in readWindow(), Select in previewSelection(), the watch in
  // respondToNewTab() — every entry point applies the same rule.
  if (scope === 'all') return visible(await api.tabs.query({ windowType: 'normal' }));
  const win = await api.windows.getCurrent();
  return visible(await api.tabs.query({ windowId: win.id }));
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

/**
 * Which tabs a reload would hit, without touching anything.
 *
 * @param {object} [opts] already-prepared reload options, so reloadTabs() does
 *   not compile the filter and re-derive the scope a second time.
 */
export async function previewReload(settings, opts = prepareReloadOptions(settings.reload)) {
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
  const { tabs, count, reason } = await previewReload(settings, opts);
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
export async function previewSelection(settings, { tab: anchor } = {}) {
  const opts = prepareSelectOptions(settings.select);
  // A tab context menu acts on the tab that was right-clicked, which may be in
  // another window and is often not the active one.
  const windowId = anchor ? anchor.windowId : (await api.windows.getCurrent()).id;
  // Visible only: highlight() takes strip indices and activates its first entry,
  // so a tab from another space in this set would both mis-address the strip and
  // pull the user out of the space they are in.
  const tabs = visible(await api.tabs.query({ windowId }));
  const context = anchor
    ? { activeTabId: anchor.id, activeGroupId: anchor.groupId ?? TAB_GROUP_ID_NONE }
    : await reloadContext();

  let chosen;
  if (opts.selection === 'duplicates') {
    const ids = new Set(findDuplicates(tabs, settings.duplicates).closeIds);
    chosen = tabs.filter((t) => ids.has(t.id));
  } else {
    chosen = selectTabs(tabs, opts, context);
  }

  return {
    windowId,
    tabs: chosen,
    count: chosen.length,
    reason: chosen.length ? '' : explainEmpty(opts, context)
  };
}

/** Highlight the selection in the tab strip, changing nothing else. */
export async function applySelection(settings, context = {}) {
  const { windowId, tabs, count, reason } = await previewSelection(settings, context);
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
  if (!(await isNormalWindow(tab.windowId))) return { acted: false };

  // Hidden tabs are excluded here for the same reason as everywhere else, and it
  // matters most on this path: the watch closes tabs on its own. A copy sitting
  // in another Zen space must not close the tab the user just opened, and must
  // not be closed or activated itself.
  const scoped = visible(
    settings.scope === 'window'
      ? await api.tabs.query({ windowId: tab.windowId })
      : await api.tabs.query({ windowType: 'normal' })
  );

  // Visible tabs only, so "the last tab in its window" means the last one the
  // user can see — a space holding a single tab must not look populated.
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
