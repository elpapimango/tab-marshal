# Chrome Web Store listing

Copy-paste source for the Chrome Web Store Developer Dashboard. Nothing here ships in the
extension. Submit at <https://chrome.google.com/webstore/devconsole>, upload
`dist/tab-marshal-<version>.zip`, built with `npm run package`.

---

## Store listing tab

### Title

*Max 45 characters.*

    Tab Marshal

### Summary

*Max 132 characters — shorter than AMO's limit, so this is trimmed further.*

    Sort and auto-group tabs by domain, URL or regex. Find duplicates, and reload tabs in bulk.

### Description

Same body copy as `store/amo-listing.md`'s **Description** section (SORTING / TAB GROUPS /
SELECTING / AUTO-GROUP / DUPLICATES / RELOAD / EXTRAS / PRIVACY) — the Chrome Web Store has no
separate character limit worth trimming for. CWS accepts plain paragraphs the same way AMO does.

**Drop the ZEN SPACES paragraph.** Zen is a Firefox fork, and the rule it describes — never act on a
hidden tab — has nothing to act on in Chrome, which has no API for hiding tabs. The behaviour still
ships in this build; it is the listing copy that would only confuse a Chrome reader.

### Category

**Productivity**

### Language

English (United States)

### Screenshots

Same source images as AMO (`store/screenshots/`), but CWS wants **1280x800 or 640x400**, not
2560x1600 — resize on export rather than reusing the AMO-sized files directly. At least one
required, up to five recommended. Same running order and captions as the AMO listing's table.

### Promotional images

Optional. Skip unless the listing is later pushed as a featured/promoted extension.

---

## Privacy practices tab

CWS requires this tab to be filled in even when the answer to every question is "no" — leaving it
blank blocks submission.

### Single purpose

*One or two sentences. CWS rejects listings whose permissions don't map to a clearly stated single
purpose — Tab Marshal's permissions cover several tab-management actions, so state the umbrella
purpose plainly.*

    Tab Marshal helps users manage large numbers of open tabs — sorting, grouping, selecting,
    deduplicating and reloading them — entirely within the browser's own tab strip.

### Permission justifications

*Required, one justification per permission requested in `manifest.json`.*

| Permission | Justification |
| --- | --- |
| `tabs` | Core to the extension's purpose: read each tab's URL, title and state to sort, filter, select and reload tabs, and move/close tabs the user asks it to act on. |
| `tabGroups` | Read existing tab groups so sorting can keep them contiguous, and create/name/colour tab groups for the Auto-group feature. |
| `storage` | Persist the user's sort options, Auto-group rules, duplicate-match settings and chosen theme, and hold a one-shot undo snapshot in session storage. |
| `contextMenus` | Adds the equivalent actions to the toolbar icon's and a tab's right-click menu, so they don't require opening the popup. |

### Are you using remote code?

**No.** The extension ships only the ES modules in `src/`; nothing is fetched and evaluated at
runtime.

### Data usage

Answer **no** to every category CWS asks about (personally identifiable information, health info,
financial info, authentication info, personal communications, location, web history, user
activity, website content) — the extension reads tab metadata locally to act on it and transmits
none of it anywhere. See `PRIVACY.md` for the full statement.

### Privacy policy URL

    https://github.com/elpapimango/tab-marshal/blob/main/PRIVACY.md

### Certification

Check "I certify that this extension does not sell or transfer user data..." — true, since nothing
is collected in the first place.

---

## Version notes (1.6.0)

**The Chrome Web Store has no release-notes field.** Neither the listing nor the update flow shows
per-version notes to users; Google's own guidance is to fold an update log into the detailed
description if you want one.

1.6.0 is the first release since 1.4.0 that a Chrome user can actually notice, so unlike 1.5.0 and
1.5.1 it is not a no-op here:

- Sorting a large window is much quicker, because tabs headed for neighbouring positions now move
  together instead of one at a time.
- Settings survive fast typing. A filter box wrote to sync storage on every keystroke and could
  exceed Chrome's 120-writes-a-minute limit, at which point the setting was silently lost.
- `https://example.com:80/` is no longer treated as the same address as `https://example.com/`, so a
  tab is no longer closed as a duplicate of a URL it does not actually match.
- Two tabs opening in the same instant could leave one unrecognised as new, which skipped Auto-Group
  and the duplicate check for it.
- Auto-Group leaves tabs in popup windows opened by web apps alone.
- Favicons in the Duplicates and Reload lists are requested without cookies; a site that does not
  allow anonymous requests shows a coloured initial instead of its icon.

None of it needs a new permission. If you want an update log in the description, the first two bullets
are the ones worth a user's attention.

---

## Test instructions

Its own step in the dashboard, alongside the privacy fields, and the only reviewer-facing field CWS
offers. Same content as AMO's reviewer notes, plus what changed in this version:

    The source is plain ES modules, unminified and dependency-free; the uploaded zip is exactly
    what is in the repository at the tagged commit. The same folder also runs unpacked in Edge and
    Firefox — manifest.json intentionally declares both background.service_worker and
    background.scripts for that reason; Chrome uses the service worker and ignores the scripts key.

    Changes in 1.6.0, all within the existing permissions and using no new APIs. Sorting now passes
    an array of tab ids to a single tabs.move call for each run of tabs bound for consecutive
    indices, rather than one call per tab; the resulting order is unchanged, and a batch the browser
    refuses is retried tab by tab. Settings writes are debounced by 300ms, because writing on every
    keystroke exceeded storage.sync's write quota and lost the setting. URL normalisation for
    duplicate matching no longer strips ports 80 and 443, which had folded https://host:80/ into
    https://host/. The set of tabs awaiting their first URL is now accessed through a serialised
    queue, so two tabs created in the same instant cannot overwrite each other's entry. Auto-Group
    checks windows.get().type before grouping, matching what the duplicate watch already did.
    Favicon <img> elements set crossOrigin="anonymous" so the request carries no cookies, with a
    locally drawn coloured initial as the fallback when a host declines the CORS request. User-supplied
    regular expressions are run against at most 2048 characters of a page-supplied title.

    Changes in 1.5.0 and 1.5.1, for context: tabs hidden by another extension are excluded from every
    action, and sorting writes tabs back into the strip positions they already occupied instead of
    packing them towards the front of the window. Both are no-ops on Chrome, which has no API for
    hiding tabs.
