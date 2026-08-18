# CLAUDE.md

Guidance for Claude Code working in this repository. See [README.md](README.md) for the user-facing
documentation and [TODO.md](TODO.md) for what is deliberately left undone.

## What this is

Tab Marshal — a Manifest V3 browser extension that sorts tabs and tab groups, manages duplicates,
auto-groups by rule, and reloads in bulk. One codebase runs unpacked on Chrome, Edge, Firefox and
Zen.

**No dependencies and no build step.** Plain ES modules, loaded as-is by the browser. The published
zip is the source. Do not introduce a bundler, a transpiler, or an npm dependency without asking —
"what you can read in the repository is what runs" is a claim PRIVACY.md makes to users.

## Layout

```
src/lib/*.js     pure logic — no chrome/browser access, unit tested with plain Node
src/lib/apply.js the only module that touches the tabs/tabGroups/windows APIs
src/background.js the service worker (event page on Firefox)
src/popup.js     the popup UI
tools/*.mjs      icon generation and the zip builder, dependency-free by design
store/*.md       the three store listings, kept current per release
```

The split matters: `sorter.js`, `select.js`, `watch.js`, `autogroup.js`, `duplicates.js`, `keys.js`
and `theme.js` are pure. They take plain tab-shaped objects and return a **plan** — a description of
the desired end state. `apply.js` carries plans out. Keep new decision logic on the pure side; that
is what makes it testable without a browser.

`lib/browser.js` resolves `browser.*` / `chrome.*` lazily through a Proxy. Never capture
`api.tabs` (or any namespace) into a module-level constant — the tests install a fresh fake global
per case, and a captured reference would still point at the first test's fake.

## Invariants — do not break these

- **Hidden tabs are never touched.** Zen keeps every space's tabs in one window and hides the others,
  so a hidden tab belongs to somebody else's space. `visible()` in `apply.js` filters them out on
  every path, and sorting reuses the *slot indices* the sortable tabs already held so nothing lands
  on a hidden tab's position. This needs no Zen detection to be correct.
- **Tab groups stay contiguous.** Groups are the unit that gets reordered (`splitIntoBlocks`), and a
  group is positioned before its members are arranged inside it. `assertAllGroupsContiguous` in the
  tests guards this.
- **Snapshot before mutating.** `sortTabs` reads every window, writes all undo snapshots in one go,
  and only then moves anything — an interrupted sort still has to be undoable.
- **Never write `storage.sync` on a keystroke.** The quota is 120 writes a minute and typing exceeds
  it, at which point the write throws and the setting is silently lost. All settings writes go
  through the 300 ms debounce in `popup.js` (`scheduleSave` / `flushSettings`).
- **Clamp any haystack a user regex runs against.** Patterns are the user's; the text is not — a page
  chooses its own title, and Auto-Group tests rules against it in the worker as tabs open. Use
  `clampForMatch()` from `lib/keys.js`.
- **Read-modify-write over storage must be serialised.** Two tabs opening in the same instant will
  otherwise erase each other's entry. See `queuePending` in `background.js`.
- **No new permissions.** The four in the manifest are the whole story, and PRIVACY.md leans on that.
  In particular Chromium's `favicon` permission is off-limits: Firefox rejects it as invalid, which
  would put a warning on every Firefox install.
- **No network requests** beyond the favicons in the duplicate and reload lists, which must stay
  `crossOrigin="anonymous"` and `referrerPolicy="no-referrer"` so they cannot identify the user.
  Anything that would change what leaves the machine also changes PRIVACY.md and the listings.

## Testing

```bash
npm test              # node --test, no runner, no config
npx --yes web-ext@latest lint --source-dir .
```

Every module has a `test/*.test.js`. The pattern for anything touching the extension APIs: build a
fake, assign `globalThis.chrome`, then dynamic-import the module with a cache-busting query so each
case gets a fresh instance.

```js
globalThis.chrome = makeFakeChrome(initial, options);
const apply = await import(`../src/lib/apply.js?t=${Math.random()}`);
```

**Make the fakes behave like the real API, not like the code under test.** `storage.get`/`set`
structured-clone, because handing out the stored object itself lets two racing readers share one map
and hides exactly the races the tests exist to catch. `tabs.move` accepts an id *or* an array and
advances the index per tab, because that is what both engines do.

When fixing a bug, check the test fails against the pre-fix code before committing it — a test that
passes either way proves nothing.

`web-ext lint` should report **0 errors and 4 warnings**: `BACKGROUND_SERVICE_WORKER_IGNORED` on the
manifest (the `service_worker` + `scripts` pair is deliberate — Chromium uses the first, Firefox the
second) and three `UNSAFE_VAR_ASSIGNMENT` from the dynamic imports in tests, which never ship.

## Style

- Comments explain **why**, not what. The existing ones are the model: they name the failure the code
  is avoiding. Match that density rather than adding narration.
- British spelling in prose and comments — colour, normalisation, memoised, serialised.
- Commit messages are prose that explains the reasoning, not bullet lists of changes. Look at
  `git log` before writing one.
- User-facing strings live next to the logic that produces them and are full sentences.

## Release ritual

1. Bump `version` in **both** `manifest.json` and `package.json`.
2. Update all three files in `store/`. AMO has a release-notes field; CWS and Partner Center do not,
   so their change summary goes in the reviewer / certification notes instead. Say plainly when a
   release is a no-op on Chromium (several have been) and when it is not.
3. Recapture any screenshot in `store/screenshots/` that a visible change affects.
4. `npm run package` → `dist/tab-marshal-<version>.zip`, reproducible and byte-identical for the same
   source. `dist/` is gitignored; the zip is not committed.
5. Annotated tag, message `Tab Marshal X.Y.Z`.
6. `git push origin main --follow-tags`.

## Corporate environment

This machine sits behind a Thales proxy with TLS interception — see `~/CLAUDE.md`. Relevant here only
for `npx web-ext`, which needs the proxy and CA bundle to fetch. Nothing the extension itself does
touches the network at build time.
