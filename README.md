# Tab Sorter

A Microsoft Edge (Manifest V3) extension that sorts tabs and tab groups, finds and closes duplicate
tabs (or stops them opening in the first place), and reloads tabs in bulk. No build step, no
dependencies — load the folder as-is.

## Install (unpacked)

1. Open `edge://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder.

It also runs unchanged in Chrome (`chrome://extensions`) and other Chromium browsers.

## Sorting

Pick a **primary** criterion, an optional **secondary** tiebreaker, and a direction:

| Criterion | Key used |
| --- | --- |
| Domain | Registrable domain — `news.bbc.co.uk` → `bbc.co.uk`, `www.` stripped |
| Hostname | Full hostname — `news.bbc.co.uk` |
| Full URL | The URL as-is |
| Host + path | `example.com/docs/api` — clusters sections of a site |
| Tab title | The tab's title |
| Last accessed | When the tab was last active (use *Descending* for most-recent-first) |
| Regular expression | See below |

Notes on behaviour:

- Comparison is case-insensitive and digit-aware, so `page2` sorts before `page10`.
- Descending reverses the **primary** criterion only, so "domain Z→A, then title A→Z" is
  expressible.
- Browser pages (`edge://`, `about:`, `file://`) collapse to their scheme under *Domain*, so they
  cluster together instead of scattering.
- Pinned tabs are sorted among themselves and stay at the front, as the browser requires.

### Regular expressions

The pattern is matched against the tab's URL (or title). **The first capture group becomes the sort
key**; without a capture group the whole match is used. Tabs that don't match are parked at the end
— in both directions, so reversing the sort never drags the leftovers to the front.

| Goal | Pattern |
| --- | --- |
| Sort by ticket id in the URL | `/browse/([A-Z]+-\d+)` |
| Sort by the first path segment | `^https?://[^/]+/([^/?#]+)` |
| Sort by subdomain | `^https?://([^.]+)\.` |
| Sort by trailing number | `(\d+)$` |

### Tab groups

Tab groups have to stay contiguous in the tab strip, so the extension treats each group as a single
movable block. **What to sort** controls how far it goes:

- **Everything** — sorts tabs inside each group, then reorders the groups and loose tabs.
- **Inside tab groups only** — groups stay exactly where they are; only their contents are sorted.
- **Ungrouped tabs only** — groups keep their slots; the loose tabs are sorted among the positions
  they already occupy.

When sorting everything, groups can be mixed in with loose tabs, forced to the front, or forced to
the end, and ordered by their tabs (same criteria), name, colour, or size.

**Undo** restores the tab order captured immediately before the last sort. It is kept in session
storage, so it survives closing the popup but not restarting the browser.

## Duplicates

**Find duplicates** lists what would be closed without touching anything; **Close duplicates**
re-runs detection and closes them, so nothing opened in between gets closed by surprise.

- *Consider duplicate when* — exact URL, ignoring `#fragment`, ignoring fragment and `?query`, or
  same host + path regardless of scheme.
- `www.` and trailing slashes can be normalised away; new-tab and blank pages are skipped by
  default.
- *Keep* the leftmost, rightmost, or most recently used tab of each set.
- Pinned tabs, grouped tabs and tabs playing audio can be protected. A protected tab automatically
  becomes the keeper for its set, and a set made only of protected tabs is left alone.

Closing tabs cannot be undone from within the extension — `Ctrl+Shift+T` reopens them one at a
time.

### Watching for duplicates

Instead of cleaning up after the fact, the extension can check tabs as they load and act if one
duplicates something already open:

| Action | Effect |
| --- | --- |
| Nothing — allow duplicates | **Default.** The watch is off |
| Close the new tab | The duplicate never sticks around; the old tab is not focused |
| Close the old tab, keep the new | The tab that just loaded takes the old one's place |
| Switch to the old tab, close the new | Jump to the copy you already had |
| Switch to the old tab, reload, close the new | Same, plus a refresh |

"New" here means whichever tab just loaded the duplicate URL.

By default only **new** tabs are judged, once each, on the first URL they commit — so navigating a
tab you have been using for an hour is never second-guessed. Ticking **also when an existing tab
navigates** widens that to every tab, every time its URL changes.

That wider mode is worth understanding before enabling it:

- Typing a URL into the tab you are looking at, or following a link in it, now counts. With *Close
  the new tab* that closes the tab in front of you and leaves you elsewhere; *Switch to the old tab*
  is usually the setting you want here.
- Going back or forward to a page you have open elsewhere counts too.
- Single-page apps rewrite their URL as you move around inside them, and each rewrite is judged.

Matching uses the same settings as manual duplicate detection — match mode, `www.`/trailing-slash
normalisation, and the protection checkboxes. Scope applies too: *This window* only compares against
tabs in the same window.

Because this closes tabs on its own, it has guard rails:

- **Off by default.**
- **A protected tab is never closed** — neither the old one nor the one that just navigated. If
  every duplicate is pinned, grouped or playing audio (per your checkboxes), nothing happens at all;
  the extension will not quietly close the *other* tab instead, since that is the opposite of what
  was asked for.
- **A tab alone in its window is never closed**, because that would close the window. The switch
  still happens; only the close is skipped.
- **Session restore is skipped.** Reopening a saved session recreates every tab at once, duplicates
  included, so the watch stays quiet for 15 seconds after the browser starts rather than deleting
  tabs you deliberately saved.
- Tabs in popup windows opened by web apps are ignored.
- The reload issued by *switch and reload* cannot re-trigger the watch: only a genuine URL **change**
  is judged, and a reload keeps the same URL.

When the watch acts, the toolbar badge briefly shows `dup` so a tab never just disappears without
explanation. Note that explicitly duplicating a tab counts as a new tab and will be caught — that
is the point, but it is worth knowing before turning it on.

## Reload

Pick what to reload; the button keeps a live count of what it will hit, and the list below shows
which tabs those are (click a row to jump to it).

- **The active tab** — just that one. Explicitly targeting a tab overrides the skip options below,
  so asking to reload a pinned tab reloads it.
- **All tabs** — everything in scope.
- **The active tab's group** — the tab group the current tab belongs to.
- **Tabs matching a filter** — *domain / hostname / URL / host+path / title* combined with
  *contains / is exactly / starts with / matches regex*. Case-insensitive unless you say otherwise.
  An empty filter matches nothing rather than everything.

Options:

- **Bypass cache** — a hard reload, ignoring the HTTP cache.
- **Skip pinned tabs**, and **skip sleeping tabs** (on by default, so a bulk reload doesn't wake
  everything Edge has put to sleep).
- **Stagger** — a pause between reloads so 60 tabs don't hit the network at once. The reload runs in
  the service worker rather than the popup, so a staggered batch finishes even if the popup closes.

Tabs the browser refuses to reload (some internal pages) are reported as skipped rather than
failing the run.

## Config

### Theme

| Group | Options |
| --- | --- |
| Default | Match browser, Light, Dark |
| Catppuccin | Match browser (Latte / Mocha), Latte, Frappé, Macchiato, Mocha |
| More | Nord, Dracula |

"Match browser" follows `prefers-color-scheme`, and updates live if the browser or OS theme changes
while the popup is open. Nord and Dracula are single-flavour dark schemes, so picking one keeps the
popup dark whatever the browser is set to.

The palettes are the official ones, with two documented exceptions in Nord: its comment colour
(nord3) sits at 1.7:1 against the background and its red (nord11) at 3.1:1, which is not readable
for the secondary text and error messages those slots carry, so both are lightened until they clear
4.5:1. Every theme's text, accent and error colours meet that threshold.

The chosen theme is resolved to a concrete palette in JS and stamped on `<html data-theme>`, so
`popup.css` has one plain block per palette instead of duplicated media queries. The resolved value
is mirrored into `localStorage` and re-applied by `src/theme-boot.js` — a small synchronous script
in `<head>` — so opening the popup on a dark theme doesn't flash white first.

### Keyboard shortcuts

The Config tab lists every command with its current binding, read live from `chrome.commands`.

| Action | Default |
| --- | --- |
| Open the Tab Sorter popup | unassigned |
| Sort tabs with saved settings | `Alt+Shift+S` |
| Close duplicate tabs | `Alt+Shift+D` |
| Reload tabs with saved selection | `Alt+Shift+R` |
| Undo last sort | unassigned |

**Bindings can only be changed on the browser's own page.** `chrome.commands` is read-only —
extensions can see their shortcuts but not set them, so "Change shortcuts…" just opens
`edge://extensions/shortcuts` (`chrome://…` on Chrome). If the browser refuses to let the extension
open that page, the address is shown for copying instead.

## Menu

Right-clicking the toolbar icon offers the saved sort, one-off sorts by domain, hostname, URL, title
and last accessed, the saved reload selection, "reload all tabs", closing duplicates, and undo.
Shortcut and menu actions have no popup to report into, so the result flashes on the toolbar badge
(`✓` / `!`).

## Scope

Every action applies to the current window or to all normal windows. Tabs are never moved *between*
windows — each window is sorted independently — but duplicate detection does look across all
windows when the scope is set to all.

## Permissions

| Permission | Why |
| --- | --- |
| `tabs` | Read tab URLs and titles, move and close tabs |
| `tabGroups` | Read group names/colours and move groups |
| `storage` | Persist settings, and hold the undo snapshot in session storage |
| `contextMenus` | The right-click menu on the toolbar icon |
| `favicon` | Show icons in the duplicates list from the browser's own cache (no network requests) |

Nothing is sent anywhere: there are no host permissions, no content scripts and no network calls.

## Development

```bash
npm test
```

91 tests cover the sorting planner, domain parsing, duplicate detection, tab selection, the
new-tab watch, theme resolution, settings round-trips, and `apply.js` driven against a fake tab
strip (group contiguity, idempotence, undo, closing duplicates, reloading, every watch action). The
logic in `src/lib/keys.js`, `src/lib/sorter.js`, `src/lib/duplicates.js`, `src/lib/select.js`,
`src/lib/watch.js` and `src/lib/theme.js` is pure — it takes plain objects and returns a result — so
it runs under plain Node with no browser stubs. `src/lib/apply.js` is the only place that talks to
`chrome.*`.

Icons are generated rather than checked in as hand-made binaries:

```bash
npm run icons
```

To produce a zip for the Partner Center:

```powershell
Compress-Archive -Path manifest.json,icons,src -DestinationPath tab-sorter.zip -Force
```

### Layout

```
manifest.json          MV3 manifest
src/background.js      service worker: commands, context menu, staggered reloads, new-tab watch
src/popup.{html,css,js} the UI
src/theme-boot.js      applies the cached theme before first paint
src/lib/keys.js        URL → domain/hostname/path keys
src/lib/sorter.js      comparators and the sort planner (pure)
src/lib/duplicates.js  duplicate detection (pure)
src/lib/select.js      tab selection and filters (pure)
src/lib/watch.js       when to judge a tab, and what to do about a duplicate (pure)
src/lib/theme.js       theme list and light/dark resolution (pure)
src/lib/apply.js       reads windows, applies plans via chrome.*
src/lib/settings.js    persisted settings
test/                  node --test suites
tools/make-icons.mjs   PNG icon generator
```

### How the sort is applied

`planSort()` returns a target arrangement; `applyPlan()` walks the strip left to right with a
cursor, so everything left of the cursor is already final and no move disturbs a placed tab. Group
members are only ever rearranged inside their own range, which is what keeps groups contiguous.
Sorting is idempotent — running it twice produces the same order.

## License

[MIT](LICENSE) © 2026 Mattias Holmertz
