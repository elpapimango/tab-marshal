# Tab Sorter

A Microsoft Edge (Manifest V3) extension that sorts tabs and tab groups, finds and closes duplicate
tabs, and reloads tabs in bulk. No build step, no dependencies — load the folder as-is.

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

## Keyboard shortcuts and menu

| Action | Default |
| --- | --- |
| Sort tabs with saved settings | `Alt+Shift+S` |
| Close duplicate tabs | `Alt+Shift+D` |
| Reload tabs with saved selection | `Alt+Shift+R` |
| Undo last sort | unassigned |

Rebind at `edge://extensions/shortcuts`. Right-clicking the toolbar icon offers the saved sort plus
one-off sorts by domain, hostname, URL, title and last accessed, the saved reload selection, and
"reload all tabs". Shortcut and menu actions have no popup to report into, so the result flashes on
the toolbar badge (`✓` / `!`).

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

50 tests cover the sorting planner, domain parsing, duplicate detection, tab selection, and
`apply.js` driven against a fake tab strip (group contiguity, idempotence, undo, closing
duplicates, reloading). The logic in `src/lib/keys.js`, `src/lib/sorter.js`, `src/lib/duplicates.js`
and `src/lib/select.js` is pure — it takes plain objects and returns a result — so it runs under
plain Node with no browser stubs. `src/lib/apply.js` is the only place that talks to `chrome.*`.

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
src/background.js      service worker: commands, context menu, staggered reloads
src/popup.{html,css,js} the UI
src/lib/keys.js        URL → domain/hostname/path keys
src/lib/sorter.js      comparators and the sort planner (pure)
src/lib/duplicates.js  duplicate detection (pure)
src/lib/select.js      tab selection and filters (pure)
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
