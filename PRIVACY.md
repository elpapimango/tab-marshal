# Privacy policy

Tab Marshal collects, stores and transmits nothing about you or your browsing.

- **No host permissions and no content scripts.** The extension never reads a page's content —
  its `tabs` permission only exposes tab metadata the browser already tracks (URL, title, pinned
  state, group membership).
- **No request that can identify you.** The only thing ever fetched over the network is a site's own
  favicon, shown in the duplicate and reload lists, requested directly from that site. It carries
  `referrerPolicy: no-referrer`, so the site is not told which extension asked, and it is made in
  anonymous CORS mode, so it carries no cookies — a site you are signed in to is not told that your
  account opened the popup. A site that does not allow anonymous access simply gets a coloured
  initial in place of its icon.
- **No analytics, telemetry, or crash reporting.** Nothing is sent to the developer or to any third
  party, ever.
- **Settings stay local.** Sort options, duplicate-match rules, reload filters, Auto-group rules and
  the chosen theme are stored with the browser's own `storage.sync` API, which syncs them between a
  user's own signed-in browser instances the same way bookmarks do. Tab Marshal itself never sees or
  transmits that data — it is the browser vendor's sync, not Tab Marshal's.
- **No accounts, no sign-in, no identifiers.** The extension has no server component at all.

This is reflected in the manifest: `browser_specific_settings.gecko.data_collection_permissions`
is declared as `["none"]`, Mozilla's manifest-level statement that the add-on transmits no user
data.

## Source

Tab Marshal is open source under the MIT licence:
<https://github.com/elpapimango/tab-marshal>

The published extension is built from that source with no minification and no dependencies — what
you can read in the repository is what runs.

## Contact

Open an issue at <https://github.com/elpapimango/tab-marshal/issues> for any privacy question.
