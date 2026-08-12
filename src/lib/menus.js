/**
 * The context-menu tree. Pure data, so the ordering and ids can be tested
 * without a browser.
 *
 * The same items serve two contexts: the toolbar icon, and a right-click on a
 * tab. Firefox and Chrome both document a "tab" context, but a browser that
 * rejects it must still get the toolbar menu — background.js falls back per
 * item rather than losing the tree.
 */

export const MENU_ROOT = 'tab-marshal-root';
export const MENU_CONTEXTS = ['action', 'tab'];
export const MENU_FALLBACK_CONTEXTS = ['action'];

/**
 * `anchored: true` marks an item that acts on the tab that was right-clicked
 * rather than on the active one.
 */
export const MENU_ITEMS = [
  { id: 'sort-saved', title: 'Sort tabs (saved settings)', icon: 'sort' },
  { id: 'sort-domain', title: 'Sort by domain', icon: 'sort' },
  { id: 'sort-hostname', title: 'Sort by hostname', icon: 'sort' },
  { id: 'sort-url', title: 'Sort by URL', icon: 'sort' },
  { id: 'sort-title', title: 'Sort by title', icon: 'sort' },
  { id: 'sort-recent', title: 'Sort by last accessed', icon: 'sort' },

  { id: 'sep-select', type: 'separator' },
  { id: 'select-saved', title: 'Select tabs (saved criteria)', icon: 'select' },
  { id: 'select-domain', title: 'Select tabs from this site', icon: 'select', anchored: true },
  { id: 'select-group', title: "Select this tab's group", icon: 'select', anchored: true },
  { id: 'select-duplicates', title: 'Select duplicate tabs', icon: 'select' },

  { id: 'sep-act', type: 'separator' },
  { id: 'close-dupes', title: 'Close duplicate tabs', icon: 'duplicates' },
  { id: 'reload-saved', title: 'Reload tabs (saved selection)', icon: 'reload' },
  { id: 'reload-all', title: 'Reload all tabs', icon: 'reload' },

  { id: 'sep-undo', type: 'separator' },
  { id: 'undo', title: 'Undo last sort', icon: 'undo' }
];

/** Glyphs shipped in icons/menu/, one pair per name. */
export const MENU_ICONS = ['sort', 'select', 'duplicates', 'reload', 'undo'];

/**
 * Icon paths for one item.
 *
 * The suffix names the scheme the file is used in, so `dark` picks the light
 * ink meant for a dark menu. Both sizes point at the same SVG — Firefox scales
 * it — but declaring 16 and 32 keeps it crisp on high-density displays.
 *
 * @param {string|undefined} icon a MENU_ICONS name
 * @param {boolean} dark whether the browser is in a dark colour scheme
 */
export function menuIconPaths(icon, dark) {
  if (!icon) return undefined;
  const file = `icons/menu/${icon}-${dark ? 'dark' : 'light'}.svg`;
  return { 16: file, 32: file };
}

/** Ids that need the right-clicked tab to mean anything. */
export const ANCHORED_ITEMS = new Set(MENU_ITEMS.filter((i) => i.anchored).map((i) => i.id));
