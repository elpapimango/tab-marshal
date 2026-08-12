import { api, isFirefox } from './lib/browser.js';
import { loadSettings } from './lib/settings.js';
import {
  sortTabs,
  undoSort,
  closeDuplicates,
  reloadTabs,
  respondToNewTab,
  duplicateActiveTab,
  applySelection
} from './lib/apply.js';
import { isBlankUrl } from './lib/duplicates.js';
import { shouldEvaluate } from './lib/watch.js';
import { getDomain } from './lib/keys.js';
import {
  MENU_ROOT,
  MENU_ITEMS,
  MENU_CONTEXTS,
  MENU_FALLBACK_CONTEXTS,
  menuIconPaths
} from './lib/menus.js';

api.runtime.onInstalled.addListener(() => {
  // An update reloads every tab's listeners; stay quiet through the churn.
  suppressWatch(5_000);
  buildMenus();
});

// Menus do not survive a browser restart, and the colour scheme may have
// changed while it was closed.
api.runtime.onStartup.addListener(() => buildMenus());

/**
 * True when the browser is in a dark colour scheme.
 *
 * Firefox runs the background as an event page, which has a DOM and so can ask.
 * A Chromium service worker has no matchMedia — and no menu icons either, so
 * there is nothing to decide.
 */
function prefersDark() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

function buildMenus() {
  const dark = prefersDark();
  api.contextMenus.removeAll(() => {
    createMenuItem({ id: MENU_ROOT, title: 'Tab Marshal' });
    for (const item of MENU_ITEMS) {
      createMenuItem({
        id: item.id,
        parentId: MENU_ROOT,
        ...(item.type ? { type: item.type } : { title: item.title }),
        // Only Firefox renders custom menu icons, and only on submenu items.
        // Chromium rejects unknown properties outright, so it never sees this.
        ...(isFirefox() && item.icon ? { icons: menuIconPaths(item.icon, dark) } : {})
      });
    }
  });
}

// Repaint the glyphs if the scheme flips while the background page is alive.
if (typeof matchMedia === 'function') {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => buildMenus());
}

/**
 * The same items appear on the toolbar icon and on a right-clicked tab. If a
 * browser rejects the "tab" context, retry with just the toolbar one rather
 * than dropping the item entirely.
 */
function createMenuItem(props) {
  api.contextMenus.create({ ...props, contexts: MENU_CONTEXTS }, () => {
    if (api.runtime.lastError) {
      api.contextMenus.create({ ...props, contexts: MENU_FALLBACK_CONTEXTS });
    }
  });
}

api.contextMenus.onClicked.addListener(async (info, tab) => {
  const settings = await loadSettings();
  const oneOff = (primary, extra = {}) => ({
    ...settings,
    sort: { ...settings.sort, primary, target: 'all', ...extra }
  });
  // On a tab context menu this is the tab that was right-clicked, which is not
  // necessarily the active one.
  const anchor = tab ? { tab } : {};
  const withSelect = (patch) => ({ ...settings, select: { ...settings.select, ...patch } });

  switch (info.menuItemId) {
    case 'sort-saved':
      return run(() => sortTabs(settings));
    case 'sort-domain':
      return run(() => sortTabs(oneOff('domain')));
    case 'sort-hostname':
      return run(() => sortTabs(oneOff('hostname')));
    case 'sort-url':
      return run(() => sortTabs(oneOff('url')));
    case 'sort-title':
      return run(() => sortTabs(oneOff('title')));
    case 'sort-recent':
      // Most recently used first is the useful direction here.
      return run(() => sortTabs(oneOff('lastAccessed', { descending: true })));

    case 'select-saved':
      return run(() => applySelection(settings, anchor));
    case 'select-domain': {
      const domain = getDomain(tab && tab.url);
      if (!domain) return undefined;
      return run(() =>
        applySelection(
          withSelect({ selection: 'filter', field: 'domain', mode: 'equals', value: domain, negate: false }),
          anchor
        )
      );
    }
    case 'select-group':
      return run(() => applySelection(withSelect({ selection: 'group' }), anchor));
    case 'select-duplicates':
      return run(() => applySelection(withSelect({ selection: 'duplicates' }), anchor));

    case 'close-dupes':
      return run(() => closeDuplicates(settings));
    case 'reload-saved':
      return run(() => reloadTabs(settings));
    case 'reload-all':
      return run(() => reloadTabs({ ...settings, reload: { ...settings.reload, selection: 'all' } }));
    case 'undo':
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
    console.error('[Tab Marshal] duplicate watch', err);
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
    console.error('[Tab Marshal]', err);
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
