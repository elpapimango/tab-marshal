import { api, isFirefox, isZen, hasTabGroups } from './lib/browser.js';
import { CRITERIA } from './lib/sorter.js';
import { MATCH_MODES } from './lib/duplicates.js';
import { DUPLICATE_ACTIONS } from './lib/watch.js';
import { SELECTIONS, SELECT_SOURCES, FILTER_FIELDS, FILTER_MODES } from './lib/select.js';
import { GROUP_COLORS, DEFAULT_RULE } from './lib/autogroup.js';
import { getDomain } from './lib/keys.js';
import { THEMES, resolveTheme } from './lib/theme.js';
import { loadSettings, saveSettings } from './lib/settings.js';
import {
  sortTabs,
  undoSort,
  previewDuplicates,
  closeDuplicates,
  previewReload,
  reloadTabs,
  previewSelection,
  applySelection,
  groupTabs,
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
  selectSource: $('selectSource'),
  selFilterRow: $('sel-filter-row'),
  selValueRow: $('sel-value-row'),
  selCase: $('sel-case'),
  selField: $('selField'),
  selMode: $('selMode'),
  selValue: $('selValue'),
  selCaseSensitive: $('selCaseSensitive'),
  selNegate: $('selNegate'),
  selSkipPinned: $('selSkipPinned'),
  selectBtn: $('select'),
  selectList: $('select-list'),
  autoGroupEnabled: $('autoGroupEnabled'),
  ruleList: $('rule-list'),
  addRule: $('add-rule'),
  groupNow: $('group-now'),
  groupUnsupportedHint: $('group-unsupported-hint'),
  theme: $('theme'),
  menuBox: $('menu-box'),
  zenHint: $('zen-hint'),
  menuIcons: $('menuIcons'),
  shortcutList: $('shortcut-list'),
  openShortcuts: $('open-shortcuts'),
  shortcutsUrl: $('shortcuts-url'),
  aboutName: $('about-name'),
  aboutVersion: $('about-version'),
  aboutHome: $('about-home'),
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
  fillOptions(el.selectSource, SELECT_SOURCES);
  fillOptions(el.selField, FILTER_FIELDS);
  fillOptions(el.selMode, FILTER_MODES);
  fillGroupedOptions(el.theme, THEMES);

  settings = await loadSettings();
  applyTheme(settings.theme);
  applySettingsToUi();
  wireEvents();
  // Rendered after wireEvents() so the generic select/input wiring below never
  // sees these dynamically-created rows — they get their own listeners instead.
  renderRules();
  // Menu glyphs are a Firefox-only feature; the control only appears where it
  // does something.
  el.menuBox.hidden = !isFirefox();
  // Zen keeps other spaces' tabs in the same window; say so where it matters.
  isZen().then((zen) => {
    el.zenHint.hidden = !zen;
  });
  // Tab groups need Chrome/Edge or Firefox 139+; grouping is a no-op elsewhere.
  const groupsSupported = hasTabGroups();
  el.groupNow.disabled = !groupsSupported;
  el.groupUnsupportedHint.hidden = groupsSupported;
  renderAbout();
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
  const sel = settings.select;

  el.scope.value = settings.scope;
  el.theme.value = settings.theme;
  el.menuIcons.checked = settings.menuIcons !== false;
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

  el.selectSource.value = sel.selection;
  el.selField.value = sel.field;
  el.selMode.value = sel.mode;
  el.selValue.value = sel.value || '';
  el.selCaseSensitive.checked = !!sel.caseSensitive;
  el.selNegate.checked = !!sel.negate;
  el.selSkipPinned.checked = !!sel.skipPinned;

  el.autoGroupEnabled.checked = !!settings.autoGroup.enabled;

  refreshConditionalUi();
}

function readUi() {
  return {
    scope: el.scope.value,
    theme: el.theme.value,
    menuIcons: el.menuIcons.checked,
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
    },
    select: {
      selection: el.selectSource.value,
      field: el.selField.value,
      mode: el.selMode.value,
      value: el.selValue.value,
      caseSensitive: el.selCaseSensitive.checked,
      negate: el.selNegate.checked,
      skipPinned: el.selSkipPinned.checked,
      skipUnloaded: false
    },
    // Rules are edited in place on `settings.autoGroup.rules` by the rule-list
    // handlers below, not read back from the DOM — there's no fixed element to
    // read them from.
    autoGroup: {
      enabled: el.autoGroupEnabled.checked,
      rules: settings.autoGroup.rules
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
      ? 'Every tab is judged each time it navigates, using the match and protection settings below.'
      : 'Each new tab is judged once, on the first page it loads, using the settings below.';

  const usesFilter = el.selection.value === 'filter';
  el.filterRow.hidden = !usesFilter;
  el.filterValueRow.hidden = !usesFilter;
  el.filterCase.hidden = !usesFilter;
  el.filterValue.placeholder = el.filterMode.value === 'regex' ? '\\.example\\.(com|org)$' : 'github.com';

  const selUsesFilter = el.selectSource.value === 'filter';
  el.selFilterRow.hidden = !selUsesFilter;
  el.selValueRow.hidden = !selUsesFilter;
  el.selCase.hidden = !selUsesFilter;
  el.selValue.placeholder = el.selMode.value === 'regex' ? '\\.example\\.(com|org)$' : 'github.com';
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
      if (btn.dataset.panel === 'panel-select') refreshSelectPreview();
      // Shortcuts may have been rebound since the popup opened.
      if (btn.dataset.panel === 'panel-config') renderShortcuts();
    });
  });

  const inputs = document.querySelectorAll('select, input');
  inputs.forEach((input) => {
    input.addEventListener('change', onSettingChanged);
    if (input.type === 'text') input.addEventListener('input', onSettingChanged);
  });

  el.sort.addEventListener('click', () => act(el.sort, () => sortTabs(settings)));
  el.undo.addEventListener('click', () => act(el.undo, () => undoSort(settings)));
  el.findDupes.addEventListener('click', onFindDuplicates);
  el.closeDupes.addEventListener('click', onCloseDuplicates);
  el.reload.addEventListener('click', onReload);
  el.selectBtn.addEventListener('click', onSelect);
  el.addRule.addEventListener('click', addRule);
  el.groupNow.addEventListener('click', () => act(el.groupNow, () => groupTabs(settings)));
  el.openShortcuts.addEventListener('click', onOpenShortcuts);

  // Keep "match browser" honest if the OS flips while the popup is open.
  darkQuery.addEventListener('change', () => applyTheme(settings.theme));

  // The popup is torn down the moment it loses focus, which can land inside the
  // debounce window. Nothing can be awaited this late, but handing the write to
  // storage before the page goes is enough for it to complete.
  window.addEventListener('pagehide', () => {
    if (unsaved) saveSettings(settings).catch(() => {});
  });
}

/** Close the popup, giving any debounced write its chance to go out first. */
async function closePopup() {
  await flushSettings();
  window.close();
}

/**
 * How long to wait for typing to stop before writing settings.
 *
 * A filter box fires on every keystroke, and `storage.sync` allows 120 writes a
 * minute — typing at any normal speed exceeds that, and the write then throws
 * with the setting quietly unsaved. The same delay also spares one tab query and
 * one storage read per character.
 */
const SAVE_DEBOUNCE_MS = 300;

let saveTimer = null;
let unsaved = false;

function scheduleSave() {
  unsaved = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSettings, SAVE_DEBOUNCE_MS);
}

/** Write now, if there is anything to write. Safe to call at any time. */
async function flushSettings() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!unsaved) return;
  unsaved = false;
  try {
    await saveSettings(settings);
  } catch (err) {
    // Still unsaved, so a later change gets another attempt — and say so, rather
    // than letting the setting vanish between opening the popup and reopening it.
    unsaved = true;
    setStatus(saveErrorMessage(err), true);
  }
}

function saveErrorMessage(err) {
  const raw = (err && err.message) || String(err);
  if (/QUOTA_BYTES/i.test(raw)) {
    return 'Too much to sync — try fewer Auto-group rules, or shorter patterns.';
  }
  if (/quota|MAX_WRITE/i.test(raw)) {
    return 'The browser is rate-limiting settings sync; that change is not saved yet.';
  }
  return `Could not save settings: ${raw}`;
}

async function onSettingChanged() {
  const previousScope = settings.scope;
  settings = readUi();
  // The parts the user sees immediately stay immediate; only the write and the
  // queries it would drag along are deferred.
  applyTheme(settings.theme);
  refreshConditionalUi();
  clearDuplicatePreview();
  scheduleSave();
  // Whether there is anything to undo depends only on the scope, so this asks
  // storage once when the scope moves rather than once per keystroke.
  if (settings.scope !== previousScope) el.undo.disabled = !(await hasUndo(settings));
  if (document.getElementById('panel-reload').classList.contains('is-active')) {
    await refreshReloadPreview();
  }
  if (document.getElementById('panel-select').classList.contains('is-active')) {
    await refreshSelectPreview();
  }
}

async function act(button, fn) {
  button.disabled = true;
  setStatus('Working…');
  try {
    const result = await fn();
    setStatus(result.message, result.ok === false);
    // Always ask rather than assume a sort left something behind: it writes its
    // snapshots before it moves anything, so by now the answer is already true.
    el.undo.disabled = !(await hasUndo(settings));
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

  li.append(faviconFor(tab));

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
 * The icon slot for one row.
 *
 * The site's own icon where it can be had without identifying the user, and a
 * monogram where it cannot — so the slot is always filled and rows stay aligned.
 */
function faviconFor(tab) {
  const src = faviconUrl(tab);
  if (!src) return monogram(tab);

  const img = document.createElement('img');
  img.alt = '';
  // Don't tell the site which extension page asked for its icon...
  img.referrerPolicy = 'no-referrer';
  // ...and don't tell it who is asking. A plain image request carries the site's
  // cookies, so a site the user is signed in to learns that *that account*
  // opened the popup — and up to PREVIEW_ROWS sites learn it in the same
  // instant. Anonymous mode makes it a credential-less CORS request instead. A
  // host that does not allow that fails to load, which is what the monogram is
  // for, so this trades some real icons for an unidentifiable request.
  img.crossOrigin = 'anonymous';
  img.src = src;
  img.addEventListener('error', () => img.replaceWith(monogram(tab)), { once: true });
  return img;
}

/**
 * A stand-in for a site's icon: its first letter over a colour derived from the
 * domain, so the same site always looks the same and the lists stay scannable
 * without a single request leaving the popup.
 */
function monogram(tab) {
  const name = getDomain(tab && tab.url) || '?';
  const span = document.createElement('span');
  span.className = 'favicon-mono';
  // The title and URL are right beside it; the letter is decoration.
  span.setAttribute('aria-hidden', 'true');
  const letter = name.match(/[a-z0-9]/i);
  // The slot is 16px, so one character is all that stays legible.
  span.textContent = letter ? letter[0].toUpperCase() : '?';
  // Hue only. Saturation and lightness are fixed in the stylesheet so the letter
  // stays readable on all ten palettes.
  span.style.setProperty('--mono-hue', String(hueForName(name)));
  return span;
}

/** Same cheap string hash as autogroup's colorForName, spread over a hue wheel. */
function hueForName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % 360;
}

/**
 * The icon the tab is already showing, as reported by the tabs API.
 *
 * Chromium's `_favicon/` endpoint would serve these from the browser's own
 * cache with no request at all, but it needs a `favicon` permission that
 * Firefox rejects outright — and a permission list only one engine accepts is
 * worse than a cached image. Only web URLs and data: URIs are used; a
 * browser-internal icon address will not load from an extension page.
 */
function faviconUrl(tab) {
  const src = tab && tab.favIconUrl;
  if (!src) return '';
  return /^(?:https?:|data:)/i.test(src) ? src : '';
}

async function focusTab(tab) {
  try {
    await api.tabs.update(tab.id, { active: true });
    await api.windows.update(tab.windowId, { focused: true });
    await closePopup();
  } catch {
    /* tab went away */
  }
}

/** Keeps the select button labelled with the live count, like the reload one. */
async function refreshSelectPreview() {
  try {
    const { tabs, count, reason } = await previewSelection(settings);
    el.selectList.replaceChildren(...tabs.slice(0, PREVIEW_ROWS).map((t) => tabRow(t)));
    el.selectBtn.textContent = count ? `Select ${count} ${count === 1 ? 'tab' : 'tabs'}` : 'Select tabs';
    el.selectBtn.disabled = count === 0;
    el.selValue.classList.remove('invalid');
    setStatus(count ? extraRowsNote(count) : reason);
  } catch (err) {
    el.selectList.replaceChildren();
    el.selectBtn.textContent = 'Select tabs';
    el.selectBtn.disabled = true;
    el.selValue.classList.add('invalid');
    setStatus(err.message || String(err), true);
  }
}

async function onSelect() {
  el.selectBtn.disabled = true;
  try {
    const result = await applySelection(settings);
    if (result.ok === false) {
      setStatus(result.message, true);
      el.selectBtn.disabled = false;
      return;
    }
    // The highlight is the confirmation, and it is behind the popup — close so
    // the tabs can be right-clicked straight away.
    await closePopup();
  } catch (err) {
    setStatus(err.message || String(err), true);
    el.selectBtn.disabled = false;
  }
}

/** '' stands for "auto-assign from the group name" — the first swatch. */
const COLOR_SWATCHES = ['', ...GROUP_COLORS];

function renderRules() {
  const rules = settings.autoGroup.rules;
  el.ruleList.replaceChildren(...rules.map((rule, index) => ruleCard(rule, index, rules.length)));
}

/** One rule: field/comparison, pattern, group name, and colour + reorder/delete. */
function ruleCard(rule, index, total) {
  const li = document.createElement('li');
  li.className = 'rule-card';

  const row1 = document.createElement('div');
  row1.className = 'rule-row';
  const fieldSel = document.createElement('select');
  fillOptions(fieldSel, FILTER_FIELDS);
  fieldSel.value = rule.field;
  fieldSel.setAttribute('aria-label', 'Match field');
  fieldSel.addEventListener('change', () => updateRule(index, { field: fieldSel.value }));
  const modeSel = document.createElement('select');
  fillOptions(modeSel, FILTER_MODES);
  modeSel.value = rule.mode;
  modeSel.setAttribute('aria-label', 'Match comparison');
  row1.append(fieldSel, modeSel);

  const row2 = document.createElement('div');
  row2.className = 'rule-row';
  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.spellcheck = false;
  valueInput.placeholder = rule.mode === 'regex' ? '\\.example\\.(com|org)$' : 'github.com';
  valueInput.value = rule.value || '';
  valueInput.setAttribute('aria-label', 'Pattern value');
  valueInput.addEventListener('input', () => updateRule(index, { value: valueInput.value }, { skipRender: true }));

  const caseLabel = document.createElement('label');
  caseLabel.className = 'chk rule-case';
  caseLabel.title = 'Case sensitive';
  caseLabel.hidden = rule.mode !== 'regex';
  const caseChk = document.createElement('input');
  caseChk.type = 'checkbox';
  caseChk.checked = !!rule.caseSensitive;
  caseChk.addEventListener('change', () => updateRule(index, { caseSensitive: caseChk.checked }, { skipRender: true }));
  caseLabel.append(caseChk, document.createTextNode(' Aa'));
  row2.append(valueInput, caseLabel);

  modeSel.addEventListener('change', () => {
    const isRegex = modeSel.value === 'regex';
    valueInput.placeholder = isRegex ? '\\.example\\.(com|org)$' : 'github.com';
    caseLabel.hidden = !isRegex;
    updateRule(index, { mode: modeSel.value }, { skipRender: true });
  });

  const row3 = document.createElement('div');
  row3.className = 'rule-row';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.spellcheck = false;
  nameInput.placeholder = 'Group name';
  nameInput.value = rule.groupName || '';
  nameInput.setAttribute('aria-label', 'Group name');
  nameInput.addEventListener('input', () => updateRule(index, { groupName: nameInput.value }, { skipRender: true }));
  row3.append(nameInput);

  const row4 = document.createElement('div');
  row4.className = 'rule-row rule-row-actions';

  const swatches = document.createElement('div');
  swatches.className = 'swatches';
  for (const color of COLOR_SWATCHES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = color ? `swatch swatch-${color}` : 'swatch swatch-auto';
    btn.title = color || 'Auto (from group name)';
    btn.setAttribute('aria-pressed', String((rule.color || '') === color));
    btn.addEventListener('click', () => updateRule(index, { color }));
    swatches.append(btn);
  }

  const buttons = document.createElement('div');
  buttons.className = 'rule-buttons';
  const upBtn = iconButton('↑', 'Move rule up', () => moveRule(index, -1));
  upBtn.disabled = index === 0;
  const downBtn = iconButton('↓', 'Move rule down', () => moveRule(index, 1));
  downBtn.disabled = index === total - 1;
  const delBtn = iconButton('✕', 'Delete rule', () => deleteRule(index));
  delBtn.classList.add('danger');
  buttons.append(upBtn, downBtn, delBtn);

  row4.append(swatches, buttons);
  li.append(row1, row2, row3, row4);
  return li;
}

function iconButton(label, title, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn';
  btn.textContent = label;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.addEventListener('click', onClick);
  return btn;
}

// A rule's pattern and group-name boxes fire per keystroke exactly like the
// filter boxes do, so every one of these goes through the same debounce.
function updateRule(index, patch, { skipRender = false } = {}) {
  const rules = settings.autoGroup.rules;
  if (!rules[index]) return;
  rules[index] = { ...rules[index], ...patch };
  scheduleSave();
  if (!skipRender) renderRules();
}

function addRule() {
  settings.autoGroup.rules = [...settings.autoGroup.rules, { ...DEFAULT_RULE }];
  scheduleSave();
  renderRules();
}

function deleteRule(index) {
  settings.autoGroup.rules = settings.autoGroup.rules.filter((_, i) => i !== index);
  scheduleSave();
  renderRules();
}

function moveRule(index, dir) {
  const rules = settings.autoGroup.rules;
  const target = index + dir;
  if (target < 0 || target >= rules.length) return;
  const next = [...rules];
  [next[index], next[target]] = [next[target], next[index]];
  settings.autoGroup.rules = next;
  scheduleSave();
  renderRules();
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

/** Name and version come from the manifest, so they can never drift from it. */
function renderAbout() {
  const manifest = api.runtime.getManifest();
  el.aboutName.textContent = manifest.name;
  el.aboutVersion.textContent = `v${manifest.version}`;
  if (manifest.homepage_url) el.aboutHome.href = manifest.homepage_url;
  else el.aboutHome.hidden = true;
}

const COMMAND_LABELS = { _execute_action: 'Open the Tab Marshal popup' };

/**
 * Commands that only earn their place on some browsers. Chrome and Edge both
 * duplicate a tab on their own, so offering a shortcut for it there would be
 * clutter; Firefox has no such shortcut, which is the only reason it exists.
 */
const COMMANDS_FOR_FIREFOX_ONLY = new Set(['duplicate-tab']);

/** Shortcuts are read-only here — only the browser's own page can rebind them. */
async function renderShortcuts() {
  let commands = [];
  try {
    commands = await api.commands.getAll();
  } catch {
    el.shortcutList.replaceChildren();
    return;
  }

  if (!isFirefox()) {
    commands = commands.filter((c) => !COMMANDS_FOR_FIREFOX_ONLY.has(c.name));
  }

  el.shortcutList.replaceChildren(
    ...commands.map((command) => {
      const li = document.createElement('li');

      const label = COMMAND_LABELS[command.name] || command.description || command.name;
      const name = document.createElement('span');
      name.className = 'shortcut-name';
      name.textContent = label;
      // The row ellipsises if the label is long, so keep the full text reachable.
      li.title = label;
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
    await closePopup();
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
