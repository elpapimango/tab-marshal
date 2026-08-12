# addons.mozilla.org listing

Copy-paste source for the AMO submission form. Nothing here ships in the extension.

Submit at <https://addons.mozilla.org/developers/addon/submit/distribution>.
Upload `dist/tab-marshal-<version>.zip`, built with `npm run package`.

---

## Name

    Tab Marshal

## URL slug

    tab-marshal

AMO derives the slug from the name and requires it to be globally unique. `tab-sorter`
is taken by an unrelated add-on of the same name, which is why this one is called
Tab Marshal. Set the slug under **Edit Product Page** if AMO does not pick it up.

## Summary

*AMO limit 250 characters. This matches `description` in manifest.json.*

    Sort tabs and tab groups by domain, URL, title, recency or regex. Find and close duplicates, prevent new ones, and reload in bulk.

## Categories

Pick up to two. Suggested: **Tabs**, then **Other** (or **Privacy & Security** — the add-on
collects nothing, though that category is a stretch).

## Description

*Rich text. Plain paragraphs and lists only — AMO strips most markup.*

Tab Marshal puts a tab strip back in order, keeps duplicates under control, and reloads tabs in bulk.

SORTING

Sort by registrable domain (news.bbc.co.uk becomes bbc.co.uk), full hostname, whole URL, host + path, tab title, when the tab was last used, or a regular expression. Add a second criterion to break ties, so "domain A-Z, then title A-Z" is one click. Comparison is case-insensitive and digit-aware, so page2 comes before page10.

With a regular expression, the first capture group becomes the sort key — /browse/([A-Z]+-\d+) groups a wall of issue tabs by project. Tabs that do not match are parked at the end rather than scattered.

TAB GROUPS

Tab groups must stay contiguous in the strip, so each group is moved as a single block. Sort inside groups, sort the groups themselves, or leave groups untouched and tidy only the loose tabs. Groups can be mixed in with loose tabs, pushed to the front, or pushed to the end, and ordered by their contents, name, colour or size. Pinned tabs stay pinned and stay at the front.

Sorting is undoable — one click restores the order from immediately before.

SELECTING

Every other panel does something to the tabs it picks. Select picks them and stops, leaving them highlighted in the tab strip so the browser's own right-click menu can take over — move to a new window, add to a group, bookmark, close, whatever it offers for a multi-tab selection. Pick by the same filter Reload uses, by tab group, by everything, or by "the duplicate copies". Invert the filter to select everything that does not match.

Most of this is also on the tab's own right-click menu, including "select every tab from this site".

DUPLICATES

Find duplicates lists what would close before anything closes. Match on the exact URL, ignoring the #fragment, ignoring the query string too, or on host and path alone. Keep the leftmost, rightmost or most recently used copy. Pinned tabs, grouped tabs and tabs playing audio can be protected, and a protected tab is never the one that closes.

The watch goes further and catches duplicates as they open: close the new tab, close the old one, or switch to the copy you already had and optionally reload it. It is off by default, judges each new tab once, and never closes a protected tab or a tab that is alone in its window. It stays quiet after a session restore, so reopening a saved session never deletes tabs you meant to keep.

RELOAD

Reload the active tab, its tab group, every tab, or every tab matching a filter on domain, hostname, URL, path or title. Hard-reload past the cache, skip pinned tabs, leave sleeping tabs asleep, and stagger the batch so sixty tabs do not hit the network at once.

EXTRAS

Ten themes, including light, dark, and browser-matching variants of Catppuccin, Nord and Dracula. Keyboard shortcuts for sorting, closing duplicates, reloading, and — because Firefox has no shortcut for it — duplicating the active tab.

PRIVACY

No host permissions, no content scripts, and nothing about your browsing is sent anywhere. The only outbound requests are the favicons shown in the duplicate and reload lists, loaded from each site's own address with no referrer.

Open source under the MIT licence: https://github.com/elpapimango/tab-marshal

## Tags

    tabs, tab management, sort, duplicate tabs, tab groups, productivity

## License

MIT (already in `LICENSE`). Select "MIT License" in AMO's picker.

## Privacy policy

Not required — `data_collection_permissions` is declared as `["none"]`, which is the manifest-level
statement that the add-on transmits no user data. Leave the field blank unless AMO asks.

## Support

- Support site: `https://github.com/elpapimango/tab-marshal/issues`
- Support email: optional. Anything entered here is public.

## Version notes (1.3.0)

    First public release.

    Sort tabs and tab groups by domain, hostname, URL, host + path, title, recency or a regular
    expression. Select tabs in bulk and hand them to the browser's own right-click menu. Find and
    close duplicates, or catch them as they open. Reload tabs by filter, group or all at once. Ten
    themes, and keyboard shortcuts for everything. Most actions are also on the tab's own
    right-click menu.

## Screenshots

Ready in `store/screenshots/`, 2560x1600 (1280x800 at 2x), upload in this order:

| File | Suggested caption |
| --- | --- |
| `1-sort.png` | Sort by domain, URL, title, recency — or a regular expression |
| `2-select.png` | Select tabs by filter, then use the browser's own right-click menu |
| `3-duplicates.png` | Review duplicates before anything closes, or catch them as they open |
| `4-reload.png` | Reload every tab matching a filter, staggered so nothing floods |
| `5-config.png` | Keyboard shortcuts and ten themes |
| `6-theme-mocha.png` | Catppuccin Mocha |
| `7-theme-latte.png` | Catppuccin Latte |
| `8-theme-nord.png` | Nord |

They are generated from the real popup against a fixed sample session, not mocked up.

## Notes for the reviewer

Not required, but this saves a round trip:

    The source is plain ES modules, unminified and dependency-free; the uploaded zip is exactly what
    is in the repository at the tagged commit.

    manifest.json intentionally declares both background.service_worker and background.scripts. This
    is the documented cross-browser pattern; Firefox uses scripts and ignores the worker. web-ext
    lint reports it as a warning for that reason. The same folder is also loaded unpacked in Chrome
    and Edge.
