import { api } from './lib/browser.js';
import { loadSettings } from './lib/settings.js';
import {
  sortTabs,
  undoSort,
  closeDuplicates,
  reloadTabs,
  respondToNewTab,
  duplicateActiveTab
} from './lib/apply.js';
import { isBlankUrl } from './lib/duplicates.js';
import { shouldEvaluate } from './lib/watch.js';

const MENU = {
  sortSaved: 'sort-saved',
  sortDomain: 'sort-domain',
  sortHostname: 'sort-hostname',
  sortUrl: 'sort-url',
  sortTitle: 'sort-title',
  sortRecent: 'sort-recent',
  closeDupes: 'close-dupes',
  reloadSaved: 'reload-saved',
  reloadAll: 'reload-all',
  undo: 'undo'
};

api.runtime.onInstalled.addListener(() => {
  // An update reloads every tab's listeners; stay quiet through the churn.
  suppressWatch(5_000);
  api.contextMenus.removeAll(() => {
    const parent = api.contextMenus.create({
      id: 'tab-sorter-root',
      title: 'Tab Sorter',
      contexts: ['action']
    });
    const add = (id, title) =>
      api.contextMenus.create({ id, title, parentId: parent, contexts: ['action'] });

    add(MENU.sortSaved, 'Sort tabs (saved settings)');
    add(MENU.sortDomain, 'Sort by domain');
    add(MENU.sortHostname, 'Sort by hostname');
    add(MENU.sortUrl, 'Sort by URL');
    add(MENU.sortTitle, 'Sort by title');
    add(MENU.sortRecent, 'Sort by last accessed');
    add(MENU.closeDupes, 'Close duplicate tabs');
    add(MENU.reloadSaved, 'Reload tabs (saved selection)');
    add(MENU.reloadAll, 'Reload all tabs');
    add(MENU.undo, 'Undo last sort');
  });
});

api.contextMenus.onClicked.addListener(async (info) => {
  const settings = await loadSettings();
  const oneOff = (primary, extra = {}) => ({
    ...settings,
    sort: { ...settings.sort, primary, target: 'all', ...extra }
  });

  switch (info.menuItemId) {
    case MENU.sortSaved:
      return run(() => sortTabs(settings));
    case MENU.sortDomain:
      return run(() => sortTabs(oneOff('domain')));
    case MENU.sortHostname:
      return run(() => sortTabs(oneOff('hostname')));
    case MENU.sortUrl:
      return run(() => sortTabs(oneOff('url')));
    case MENU.sortTitle:
      return run(() => sortTabs(oneOff('title')));
    case MENU.sortRecent:
      // Most recently used first is the useful direction here.
      return run(() => sortTabs(oneOff('lastAccessed', { descending: true })));
    case MENU.closeDupes:
      return run(() => closeDuplicates(settings));
    case MENU.reloadSaved:
      return run(() => reloadTabs(settings));
    case MENU.reloadAll:
      return run(() => reloadTabs({ ...settings, reload: { ...settings.reload, selection: 'all' } }));
    case MENU.undo:
      return run(() => undoSort(settings));
    default:
      return undefined;
  }
});

api.commands.onCommand.addListener(async (command) => {
  const settings = await loadSettings();
  if (command === 'sort-tabs') return run(() => sortTabs(settings));
  if (command === 'close-duplicates') return run(() => closeDuplicates(settings));
  if (command === 'reload-tabs') return run(() => reloadTabs(settings));
  if (command === 'undo-sort') return run(() => undoSort(settings));
  if (command === 'duplicate-tab') {
    return run(async () => {
      // Deliberately making a copy, so the watch must not treat it as an
      // accident and close it again the instant it appears.
      await suppressWatch(1500);
      return duplicateActiveTab();
    });
  }
  return undefined;
});

/**
 * A staggered reload can outlive the popup, which is torn down the moment it
 * loses focus, so the popup hands the work to the worker instead of running the
 * loop itself.
 */
api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'reload') return false;
  reloadTabs(message.settings).then(sendResponse, (err) =>
    sendResponse({ ok: false, reloaded: 0, message: err.message || String(err) })
  );
  return true; // keep the channel open for the async response
});

/* ------------------------------------------------------------------ *
 * Duplicate watch
 *
 * A tab is created with no URL and navigates a moment later, and the service
 * worker can be evicted in between — so the set of tabs still awaiting their
 * first URL lives in session storage, not in a module variable.
 * ------------------------------------------------------------------ */

const PENDING_KEY = 'watchPendingTabs';
const SUPPRESS_KEY = 'watchSuppressedUntil';
/** A tab that never navigates should not sit in the pending set forever. */
const PENDING_TTL_MS = 60_000;

/**
 * Session restore recreates every saved tab, duplicates included. Acting on
 * that burst would close tabs the user deliberately saved, so the watch stays
 * quiet for a moment after the browser starts.
 */
async function suppressWatch(ms) {
  await api.storage.session.set({ [SUPPRESS_KEY]: Date.now() + ms });
}

async function isSuppressed() {
  const until = (await api.storage.session.get(SUPPRESS_KEY))[SUPPRESS_KEY] || 0;
  return Date.now() < until;
}

api.runtime.onStartup.addListener(() => suppressWatch(15_000));

async function readPending() {
  return (await api.storage.session.get(PENDING_KEY))[PENDING_KEY] || {};
}

async function markPending(tabId) {
  const pending = await readPending();
  const cutoff = Date.now() - PENDING_TTL_MS;
  for (const [id, at] of Object.entries(pending)) {
    if (at < cutoff) delete pending[id];
  }
  pending[tabId] = Date.now();
  await api.storage.session.set({ [PENDING_KEY]: pending });
}

async function takePending(tabId) {
  const pending = await readPending();
  if (!pending[tabId]) return false;
  delete pending[tabId];
  await api.storage.session.set({ [PENDING_KEY]: pending });
  return true;
}

api.tabs.onCreated.addListener(async (tab) => {
  if (await isSuppressed()) return;
  await markPending(tab.id);
  // Duplicating a tab or opening a bookmark in a new tab arrives with the URL
  // already set, so there may never be an onUpdated to wait for.
  if (tab.url && !isBlankUrl(tab.url)) {
    if (await takePending(tab.id)) await evaluateTab(tab.id, tab, 'new-tab');
  }
});

api.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only a real URL change is interesting. A plain reload keeps the same URL
  // and so never lands here, which is what stops the reload issued by
  // "switch and reload" from re-triggering the watch.
  if (!changeInfo.url) return;
  const wasNew = await takePending(tabId);
  await evaluateTab(tabId, tab, wasNew ? 'new-tab' : 'navigation');
});

api.tabs.onRemoved.addListener((tabId) => {
  takePending(tabId).catch(() => {});
});

/**
 * Judge one URL change. New tabs are judged once, on their first committed
 * URL; existing tabs are only judged if the user opted into that.
 */
async function evaluateTab(tabId, tab, source) {
  try {
    if (await isSuppressed()) return;

    const settings = await loadSettings();
    if (!shouldEvaluate(source, settings.watch)) return;

    const fresh = tab && tab.url ? tab : await api.tabs.get(tabId);
    const { acted } = await respondToNewTab(fresh, settings);
    if (acted) await flashBadge('dup', '#0f6cbd');
  } catch (err) {
    console.error('[Tab Sorter] duplicate watch', err);
  }
}

/**
 * Keyboard shortcuts and context-menu clicks have no popup to report into, so
 * flash the result on the toolbar badge instead.
 */
async function run(fn) {
  try {
    const result = await fn();
    await flashBadge(result && result.ok === false ? '–' : '✓', '#2d7d46');
  } catch (err) {
    console.error('[Tab Sorter]', err);
    await flashBadge('!', '#c5221f');
  }
}

let badgeTimer = null;
async function flashBadge(text, color) {
  await api.action.setBadgeBackgroundColor({ color });
  await api.action.setBadgeText({ text });
  if (badgeTimer) clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => api.action.setBadgeText({ text: '' }), 1800);
}
