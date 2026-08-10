import { api, isFirefox } from './lib/browser.js';
import { CRITERIA } from './lib/sorter.js';
import { MATCH_MODES } from './lib/duplicates.js';
import { DUPLICATE_ACTIONS } from './lib/watch.js';
import { SELECTIONS, FILTER_FIELDS, FILTER_MODES } from './lib/select.js';
import { THEMES, resolveTheme } from './lib/theme.js';
import { loadSettings, saveSettings } from './lib/settings.js';
import {
  sortTabs,
  undoSort,
  previewDuplicates,
  closeDuplicates,
  previewReload,
  reloadTabs,
  hasUndo
} from './lib/apply.js';

const $ = (id) => document.getElementById(id);

const el = {
  scope: $('scope'),
  primary: $('primary'),
  secondary: $('secondary'),
  direction: $('direction'),
  target: $('target'),
  groupBox: $('group-box'),
  groupPlacement: $('groupPlacement'),
  groupOrderBy: $('groupOrderBy'),
  regexRow: $('regex-row'),
  regexOpts: $('regex-opts'),
  regexHint: $('regex-hint'),
  regexPattern: $('regexPattern'),
  regexSource: $('regexSource'),
  regexIgnoreCase: $('regexIgnoreCase'),
  sort: $('sort'),
  undo: $('undo'),
  matchMode: $('matchMode'),
  ignoreWww: $('ignoreWww'),
  ignoreTrailingSlash: $('ignoreTrailingSlash'),
  ignoreBlank: $('ignoreBlank'),
  keep: $('keep'),
  protectPinned: $('protectPinned'),
  protectGrouped: $('protectGrouped'),
  protectAudible: $('protectAudible'),
  onDuplicate: $('onDuplicate'),
  includeNavigation: $('includeNavigation'),
  watchHint: $('watch-hint'),
  findDupes: $('find-dupes'),
  closeDupes: $('close-dupes'),
  dupeList: $('dupe-list'),
  selection: $('selection'),
  filterRow: $('filter-row'),
  filterValueRow: $('filter-value-row'),
  filterCase: $('filter-case'),
  filterField: $('filterField'),
  filterMode: $('filterMode'),
  filterValue: $('filterValue'),
  caseSensitive: $('caseSensitive'),
  bypassCache: $('bypassCache'),
  skipPinned: $('skipPinned'),
  skipUnloaded: $('skipUnloaded'),
  delayMs: $('delayMs'),
  reload: $('reload'),
  reloadList: $('reload-list'),
  theme: $('theme'),
  shortcutList: $('shortcut-list'),
  openShortcuts: $('open-shortcuts'),
  shortcutsUrl: $('shortcuts-url'),
  status: $('status')
};

let settings;
let pendingCloseIds = [];
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

init();

async function init() {
  fillOptions(el.primary, CRITERIA);
  fillOptions(el.secondary, [{ id: 'none', label: 'Nothing' }, ...CRITERIA]);
  fillOptions(el.matchMode, MATCH_MODES);
  fillOptions(el.onDuplicate, DUPLICATE_ACTIONS);
  fillOptions(el.selection, SELECTIONS);
  fillOptions(el.filterField, FILTER_FIELDS);
  fillOptions(el.filterMode, FILTER_MODES);
  fillGroupedOptions(el.theme, THEMES);

  settings = await loadSettings();
  applyTheme(settings.theme);
  applySettingsToUi();
  wireEvents();
  await renderShortcuts();
  el.undo.disabled = !(await hasUndo(settings));
}

/** Options split into <optgroup>s by their `group` property. */
function fillGroupedOptions(select, items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push(item);
  }
  select.replaceChildren(
    ...[...groups].map(([label, members]) => {
      const group = document.createElement('optgroup');
      group.label = label;
      group.append(
        ...members.map((m) => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.label;
          return opt;
        })
      );
      return group;
    })
  );
}

function fillOptions(select, items) {
  select.replaceChildren(
    ...items.map((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.label;
      return opt;
    })
  );
}

function applySettingsToUi() {
  const s = settings.sort;
  const d = settings.duplicates;
  const r = settings.reload;
  const w = settings.watch;

  el.scope.value = settings.scope;
  el.theme.value = settings.theme;
  el.primary.value = s.primary;
  el.secondary.value = s.secondary || 'none';
  el.direction.value = s.descending ? 'desc' : 'asc';
  el.target.value = s.target;
  el.groupPlacement.value = s.groupPlacement;
  el.groupOrderBy.value = s.groupOrderBy;
  el.regexPattern.value = s.regexPattern || '';
  el.regexSource.value = s.regexSource;
  el.regexIgnoreCase.checked = !!s.regexIgnoreCase;

  el.matchMode.value = d.matchMode;
  el.ignoreWww.checked = !!d.ignoreWww;
  el.ignoreTrailingSlash.checked = !!d.ignoreTrailingSlash;
  el.ignoreBlank.checked = !!d.ignoreBlank;
  el.keep.value = d.keep;
  el.protectPinned.checked = !!d.protectPinned;
  el.protectGrouped.checked = !!d.protectGrouped;
  el.protectAudible.checked = !!d.protectAudible;
  el.onDuplicate.value = w.onDuplicate;
  el.includeNavigation.checked = !!w.includeNavigation;

  el.selection.value = r.selection;
  el.filterField.value = r.field;
  el.filterMode.value = r.mode;
  el.filterValue.value = r.value || '';
  el.caseSensitive.checked = !!r.caseSensitive;
  el.bypassCache.checked = !!r.bypassCache;
  el.skipPinned.checked = !!r.skipPinned;
  el.skipUnloaded.checked = !!r.skipUnloaded;
  el.delayMs.value = String(r.delayMs);

  refreshConditionalUi();
}

function readUi() {
  return {
    scope: el.scope.value,
    theme: el.theme.value,
    sort: {
      primary: el.primary.value,
      secondary: el.secondary.value,
      descending: el.direction.value === 'desc',
      target: el.target.value,
      groupPlacement: el.groupPlacement.value,
      groupOrderBy: el.groupOrderBy.value,
      regexPattern: el.regexPattern.value,
      regexSource: el.regexSource.value,
      regexIgnoreCase: el.regexIgnoreCase.checked
    },
    duplicates: {
      matchMode: el.matchMode.value,
      ignoreWww: el.ignoreWww.checked,
      ignoreTrailingSlash: el.ignoreTrailingSlash.checked,
      ignoreBlank: el.ignoreBlank.checked,
      keep: el.keep.value,
      protectPinned: el.protectPinned.checked,
      protectGrouped: el.protectGrouped.checked,
      protectAudible: el.protectAudible.checked
    },
    watch: {
      onDuplicate: el.onDuplicate.value,
      includeNavigation: el.includeNavigation.checked
    },
    reload: {
      selection: el.selection.value,
      field: el.filterField.value,
      mode: el.filterMode.value,
      value: el.filterValue.value,
      caseSensitive: el.caseSensitive.checked,
      bypassCache: el.bypassCache.checked,
      skipPinned: el.skipPinned.checked,
      skipUnloaded: el.skipUnloaded.checked,
      delayMs: Number(el.delayMs.value)
    }
  };
}

function refreshConditionalUi() {
  const usesRegex = el.primary.value === 'regex' || el.secondary.value === 'regex';
  el.regexRow.hidden = !usesRegex;
  el.regexOpts.hidden = !usesRegex;
  el.regexHint.hidden = !usesRegex;
  // Group placement only means anything when whole blocks may be reordered.
  el.groupBox.disabled = el.target.value !== 'all';

  // Nothing under the watch matters while it is set to allow duplicates.
  const watching = el.onDuplicate.value !== 'ignore';
  el.includeNavigation.disabled = !watching;
  el.watchHint.textContent = !watching
    ? 'Duplicates are allowed; nothing happens automatically.'
    : el.includeNavigation.checked
      ? 'Every tab is judged each time it navigates, using the match and protection settings above.'
      : 'Each new tab is judged once, on the first page it loads, using the settings above.';

  const usesFilter = el.selection.value === 'filter';
  el.filterRow.hidden = !usesFilter;
  el.filterValueRow.hidden = !usesFilter;
  el.filterCase.hidden = !usesFilter;
  el.filterValue.placeholder = el.filterMode.value === 'regex' ? '\\.example\\.(com|org)$' : 'github.com';
}

function wireEvents() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
      document.querySelectorAll('.panel').forEach((p) => {
        p.classList.toggle('is-active', p.id === btn.dataset.panel);
      });
      setStatus('');
      if (btn.dataset.panel === 'panel-reload') refreshReloadPreview();
      // Shortcuts may have been rebound since the popup opened.
      if (btn.dataset.panel === 'panel-config') renderShortcuts();
    });
  });

  const inputs = document.querySelectorAll('select, input');
  inputs.forEach((input) => {
    input.addEventListener('change', onSettingChanged);
    if (input.type === 'text') input.addEventListener('input', onSettingChanged);
  });

  el.sort.addEventListener('click', () => act(el.sort, () => sortTabs(settings), { undoable: true }));
  el.undo.addEventListener('click', () => act(el.undo, () => undoSort(settings)));
  el.findDupes.addEventListener('click', onFindDuplicates);
  el.closeDupes.addEventListener('click', onCloseDuplicates);
  el.reload.addEventListener('click', onReload);
  el.openShortcuts.addEventListener('click', onOpenShortcuts);

  // Keep "match browser" honest if the OS flips while the popup is open.
  darkQuery.addEventListener('change', () => applyTheme(settings.theme));
}

async function onSettingChanged() {
  settings = readUi();
  applyTheme(settings.theme);
  refreshConditionalUi();
  clearDuplicatePreview();
  await saveSettings(settings);
  el.undo.disabled = !(await hasUndo(settings));
  if (document.getElementById('panel-reload').classList.contains('is-active')) {
    await refreshReloadPreview();
  }
}

async function act(button, fn, { undoable = false } = {}) {
  button.disabled = true;
  setStatus('Working…');
  try {
    const result = await fn();
    setStatus(result.message, result.ok === false);
    if (undoable) el.undo.disabled = false;
    else el.undo.disabled = !(await hasUndo(settings));
  } catch (err) {
    setStatus(err.message || String(err), true);
    markRegexInvalid(/regular expression/i.test(err.message || ''));
  } finally {
    button.disabled = false;
  }
}

async function onFindDuplicates() {
  el.findDupes.disabled = true;
  setStatus('Scanning…');
  try {
    const { sets, closeIds, closeCount } = await previewDuplicates(settings);
    pendingCloseIds = closeIds;
    renderDuplicates(sets);
    el.closeDupes.disabled = closeCount === 0;
    setStatus(
      closeCount === 0
        ? 'No duplicate tabs found.'
        : `${closeCount} duplicate ${closeCount === 1 ? 'tab' : 'tabs'} across ${sets.length} ${
            sets.length === 1 ? 'address' : 'addresses'
          }.`
    );
  } catch (err) {
    setStatus(err.message || String(err), true);
  } finally {
    el.findDupes.disabled = false;
  }
}

async function onCloseDuplicates() {
  el.closeDupes.disabled = true;
  setStatus('Closing…');
  try {
    // Re-run detection so nothing opened since the preview gets closed by surprise.
    const result = await closeDuplicates(settings);
    setStatus(result.message);
    clearDuplicatePreview();
  } catch (err) {
    setStatus(err.message || String(err), true);
    el.closeDupes.disabled = pendingCloseIds.length === 0;
  }
}

function clearDuplicatePreview() {
  pendingCloseIds = [];
  el.dupeList.replaceChildren();
  el.closeDupes.disabled = true;
}

function renderDuplicates(sets) {
  el.dupeList.replaceChildren(
    ...sets.map((set) =>
      tabRow(set.keep, `−${set.close.length}`, `Keeping: ${set.keep.title || set.keep.url}`)
    )
  );
}

/** One row of the tab lists: favicon, title, URL, optional trailing note. */
function tabRow(tab, trailing = '', tooltip = '') {
  const li = document.createElement('li');
  li.title = tooltip || tab.title || tab.url || '';

  const img = document.createElement('img');
  img.alt = '';
  const icon = faviconUrl(tab.url);
  // An empty src is not "no image" — some engines resolve it against the
  // document and request the page itself. Leave the attribute off instead; the
  // slot keeps its width either way, so rows stay aligned.
  if (icon) {
    img.src = icon;
    // Pages with nothing in the favicon cache would otherwise show a broken image.
    img.addEventListener('error', () => {
      img.style.visibility = 'hidden';
    });
  }
  li.append(img);

  const text = document.createElement('div');
  text.className = 'dupe-text';
  const title = document.createElement('span');
  title.className = 'dupe-title';
  title.textContent = tab.title || tab.url;
  const url = document.createElement('span');
  url.className = 'dupe-url';
  url.textContent = tab.url;
  text.append(title, url);
  li.append(text);

  if (trailing) {
    const note = document.createElement('span');
    note.className = 'dupe-count';
    note.textContent = trailing;
    li.append(note);
  }

  li.addEventListener('click', () => focusTab(tab));
  return li;
}

const PREVIEW_ROWS = 40;

/** Keeps the reload button labelled with the live count of what it would hit. */
async function refreshReloadPreview() {
  try {
    const { tabs, count, reason } = await previewReload(settings);
    el.reloadList.replaceChildren(...tabs.slice(0, PREVIEW_ROWS).map((t) => tabRow(t)));
    el.reload.textContent = count ? `Reload ${count} ${count === 1 ? 'tab' : 'tabs'}` : 'Reload tabs';
    el.reload.disabled = count === 0;
    el.filterValue.classList.remove('invalid');
    setStatus(count ? extraRowsNote(count) : reason);
  } catch (err) {
    el.reloadList.replaceChildren();
    el.reload.textContent = 'Reload tabs';
    el.reload.disabled = true;
    el.filterValue.classList.add('invalid');
    setStatus(err.message || String(err), true);
  }
}

function extraRowsNote(count) {
  return count > PREVIEW_ROWS ? `Showing the first ${PREVIEW_ROWS} of ${count}.` : '';
}

async function onReload() {
  el.reload.disabled = true;
  setStatus('Reloading…');
  try {
    // The worker runs the loop so a staggered reload survives the popup closing.
    const result = await api.runtime.sendMessage({ type: 'reload', settings });
    setStatus(result.message, result.ok === false);
  } catch {
    // No service worker (or it declined the message) — do it here instead.
    try {
      const result = await reloadTabs(settings);
      setStatus(result.message, result.ok === false);
    } catch (err) {
      setStatus(err.message || String(err), true);
    }
  } finally {
    el.reload.disabled = false;
  }
}

/**
 * Favicons come from the browser's own cache, so no network request is made.
 * The `_favicon/` endpoint is Chromium-only; on Firefox there is nothing to
 * ask, so the row keeps its icon slot empty rather than requesting a 404.
 */
function faviconUrl(pageUrl) {
  if (isFirefox()) return '';
  const url = new URL(api.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl || '');
  url.searchParams.set('size', '16');
  return url.toString();
}

async function focusTab(tab) {
  try {
    await api.tabs.update(tab.id, { active: true });
    await api.windows.update(tab.windowId, { focused: true });
    window.close();
  } catch {
    /* tab went away */
  }
}

/** Resolve "match browser" to a concrete palette and stamp it on <html>. */
function applyTheme(choice) {
  const resolved = resolveTheme(choice, darkQuery.matches);
  document.documentElement.dataset.theme = resolved;
  try {
    // Read back by theme-boot.js on the next open, before the first paint.
    localStorage.setItem('tabSorterTheme', resolved);
  } catch {
    /* storage unavailable; the theme still applies for this session */
  }
}

const COMMAND_LABELS = { _execute_action: 'Open the Tab Sorter popup' };

/** Shortcuts are read-only here — only the browser's own page can rebind them. */
async function renderShortcuts() {
  let commands = [];
  try {
    commands = await api.commands.getAll();
  } catch {
    el.shortcutList.replaceChildren();
    return;
  }

  el.shortcutList.replaceChildren(
    ...commands.map((command) => {
      const li = document.createElement('li');

      const name = document.createElement('span');
      name.className = 'shortcut-name';
      name.textContent = COMMAND_LABELS[command.name] || command.description || command.name;
      li.append(name);

      if (command.shortcut) {
        const key = document.createElement('kbd');
        key.textContent = command.shortcut;
        li.append(key);
      } else {
        const unset = document.createElement('span');
        unset.className = 'unset';
        unset.textContent = 'not set';
        li.append(unset);
      }
      return li;
    })
  );
}

function shortcutsPageUrl() {
  if (isFirefox()) return 'about:addons';
  // Edge and Chrome host the same page under their own scheme.
  return navigator.userAgent.includes('Edg/')
    ? 'edge://extensions/shortcuts'
    : 'chrome://extensions/shortcuts';
}

async function onOpenShortcuts() {
  const url = shortcutsPageUrl();

  if (isFirefox()) {
    // Firefox rejects tabs.create for privileged about: pages, and its shortcut
    // screen has no address of its own — it is a panel inside about:addons.
    // Attempting the call would only produce an error, so show the route.
    el.shortcutsUrl.textContent = 'about:addons → ⚙ → Manage Extension Shortcuts';
    el.shortcutsUrl.hidden = false;
    setStatus('Firefox only allows shortcuts to be edited from about:addons.');
    return;
  }

  try {
    await api.tabs.create({ url });
    window.close();
  } catch {
    // Some builds refuse to let an extension open browser pages; show the
    // address so it can be pasted instead.
    el.shortcutsUrl.textContent = url;
    el.shortcutsUrl.hidden = false;
    setStatus('Copy this address into a new tab to edit shortcuts.', true);
  }
}

function markRegexInvalid(invalid) {
  el.regexPattern.classList.toggle('invalid', !!invalid);
}

function setStatus(text, isError = false) {
  el.status.textContent = text || '';
  el.status.classList.toggle('error', !!isError);
  if (!isError) markRegexInvalid(false);
}
