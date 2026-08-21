# TODO

Known work, deliberately not done. Nothing here is blocking and nothing is user-visible.

Last reviewed: 2026-08-21, at 1.6.0.

## Before the 1.6.0 store submission

- [ ] **Recapture `store/screenshots/4-duplicates.png` and `5-reload.png`.** Both are rows of
      favicons, and 1.6.0 fetches those without cookies — a sample site that declines an anonymous
      request now shows a coloured monogram instead of its icon. The layout is unchanged, so the
      existing shots are not wrong, but they no longer match a fresh run. No other panel is affected.
- [ ] **Upload `dist/tab-marshal-1.6.0.zip`** to AMO, the Chrome Web Store and Partner Center. The
      release notes and the reviewer / certification text are already written in `store/`.

## Deferred code

- [ ] **The badge can stick.** `flashBadge` in `src/background.js:390` clears itself with
      `setTimeout(…, 1800)`. If Chromium evicts the service worker inside that window the badge stays
      until the next action. The fix is `chrome.alarms`, which costs a permission for a cosmetic bug —
      probably not worth it, but this is why the behaviour exists. **No new permissions** is an
      invariant (see CLAUDE.md), so this stays undone until that trade-off is revisited on purpose.

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
