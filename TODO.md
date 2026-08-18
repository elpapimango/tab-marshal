# TODO

Known work, deliberately not done. Nothing here is blocking and nothing is user-visible.

Last reviewed: 2026-08-18, at 1.6.0.

## Before the 1.6.0 store submission

- [ ] **Recapture `store/screenshots/4-duplicates.png` and `5-reload.png`.** Both are rows of
      favicons, and 1.6.0 fetches those without cookies — a sample site that declines an anonymous
      request now shows a coloured monogram instead of its icon. The layout is unchanged, so the
      existing shots are not wrong, but they no longer match a fresh run. No other panel is affected.
- [ ] **Upload `dist/tab-marshal-1.6.0.zip`** to AMO, the Chrome Web Store and Partner Center. The
      release notes and the reviewer / certification text are already written in `store/`.

## Deferred code

- [ ] **Validate the cached theme id.** `src/theme-boot.js:11` puts whatever is in `localStorage`
      onto `data-theme` without checking it against `CONCRETE_THEMES`. No security impact — it is an
      attribute, not markup — but if a palette is ever removed from `popup.css`, a user holding that
      id sees an unstyled popup until their first settings change. Two lines. Worth doing next time
      the theme code is open.

- [ ] **The badge can stick.** `flashBadge` in `src/background.js:390` clears itself with
      `setTimeout(…, 1800)`. If Chromium evicts the service worker inside that window the badge stays
      until the next action. The fix is `chrome.alarms`, which costs a permission for a cosmetic bug —
      probably not worth it, but this is why the behaviour exists.

- [ ] **Auto-Group recompiles every rule's regex per new tab.** `prepareAutoGroupRules`
      (`src/lib/autogroup.js:35`) runs on each tab creation via `applyAutoGroupTab`. Caching on the
      rules array's identity is *unsafe*: `updateRule` in `popup.js` replaces elements in place
      without changing the array, so the cache would serve stale patterns. Needs a real invalidation
      key. The worker's settings cache already removed the larger cost, which was the storage read.

- [ ] **The same list is sorted twice.** `apply.js:38` orders a window's tabs by index, then
      `splitIntoBlocks` (`sorter.js:188`) orders them again. Micro-optimisation; would mean giving
      `splitIntoBlocks` a way to accept an already-ordered list.

## Considered and rejected

Kept here so they are not re-litigated.

- **Chromium's `_favicon/` endpoint** would serve list icons from the browser's own cache with no
  request at all, but it needs a `favicon` permission Firefox rejects as invalid — a warning on every
  Firefox install. The shared cookieless path is the better trade.
- **Dropping remote favicons entirely** in favour of monograms everywhere would make PRIVACY.md
  absolute ("no network requests", full stop), but loses the real icons. The current hybrid keeps
  icons where a host permits an anonymous request.
- **Detecting Zen** to decide whether to skip hidden tabs. Zen's workspace controller
  (`nsZenWorkspaces`) is browser-chrome code no WebExtension can reach, and the hidden-tab rule needs
  no detection to be correct. `isZen()` exists only to show a hint in the UI.
