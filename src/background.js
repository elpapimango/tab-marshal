import { loadSettings } from './lib/settings.js';
import { sortTabs, undoSort, closeDuplicates, reloadTabs } from './lib/apply.js';

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

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    const parent = chrome.contextMenus.create({
      id: 'tab-sorter-root',
      title: 'Tab Sorter',
      contexts: ['action']
    });
    const add = (id, title) =>
      chrome.contextMenus.create({ id, title, parentId: parent, contexts: ['action'] });

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

chrome.contextMenus.onClicked.addListener(async (info) => {
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

chrome.commands.onCommand.addListener(async (command) => {
  const settings = await loadSettings();
  if (command === 'sort-tabs') return run(() => sortTabs(settings));
  if (command === 'close-duplicates') return run(() => closeDuplicates(settings));
  if (command === 'reload-tabs') return run(() => reloadTabs(settings));
  if (command === 'undo-sort') return run(() => undoSort(settings));
  return undefined;
});

/**
 * A staggered reload can outlive the popup, which is torn down the moment it
 * loses focus, so the popup hands the work to the worker instead of running the
 * loop itself.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'reload') return false;
  reloadTabs(message.settings).then(sendResponse, (err) =>
    sendResponse({ ok: false, reloaded: 0, message: err.message || String(err) })
  );
  return true; // keep the channel open for the async response
});

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
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  if (badgeTimer) clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1800);
}
