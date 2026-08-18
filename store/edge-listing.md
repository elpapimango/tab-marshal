# Microsoft Edge Add-ons listing

Copy-paste source for Microsoft Partner Center. Nothing here ships in the extension. Submit at
<https://partner.microsoft.com/dashboard/microsoftedge/overview>, upload
`dist/tab-marshal-<version>.zip`, built with `npm run package`. Edge accepts a Chrome-Web-Store-built
package unchanged — same manifest, same zip.

---

## Availability

### Category

**Productivity**

### Store listing languages

English (United States) — add more only if the description is translated too.

---

## Properties tab

### Privacy policy URL

    https://github.com/elpapimango/tab-marshal/blob/main/PRIVACY.md

### Website (optional)

    https://github.com/elpapimango/tab-marshal

### Support contact

    https://github.com/elpapimango/tab-marshal/issues

### Single purpose description

Same text as `store/chrome-listing.md`'s **Single purpose** section — Partner Center asks the same
question in different wording ("What does your extension do?"):

    Tab Marshal helps users manage large numbers of open tabs — sorting, grouping, selecting,
    deduplicating and reloading them — entirely within the browser's own tab strip.

---

## Store listings tab

### Name

*Read-only in Partner Center — populated from `name` in manifest.json.*

    Tab Marshal

### Short description

*Also read-only: Partner Center fills it from `description` in manifest.json, so changing it means
editing the manifest and re-uploading the package, not typing in this field. Already matches.*

    Sort and auto-group tabs by domain, URL, title or regex. Find and close duplicates, prevent new ones, and reload in bulk.

### Description

Same body copy as `store/amo-listing.md`'s **Description** section, minus the ZEN SPACES paragraph —
Edge, like Chrome, has no API for hiding tabs, so that paragraph describes nothing an Edge user can
see (the behaviour still ships in this build). Partner Center has no separate length limit worth
trimming for.

### Category

**Productivity**

### Screenshots

Same source as the Chrome listing — 1280x800 (Partner Center also accepts 640x480), up to six
images rather than Chrome's five, same order and captions as `store/amo-listing.md`'s table. Edge
additionally accepts a 440x280 small tile and a 1400x560 large tile; skip both unless the listing is
later pushed as featured.

### Search terms

    tab management, sort tabs, tab groups, auto-group, duplicate tabs, productivity

---

## Age ratings tab

Microsoft-specific step neither AMO nor CWS has — Partner Center will not let a listing go live
without an age rating. Complete the IARC questionnaire; Tab Marshal has no content of its own, no
user-generated content, no ads, and no data collection, so it should clear the lowest rating tier
(**3+ / Everyone**) on every question.

---

## Version notes (1.5.0)

**Partner Center has no release-notes field either.** The submission is Packages / Availability /
Properties / Privacy / Store listings / Age ratings, and none of them take per-version notes, so
nothing user-facing is needed for 1.5.0 — the release only stops the extension acting on tabs another
extension has hidden, and Edge, like Chrome, has no API for hiding tabs. Behaviour on Edge is
unchanged from 1.4.0.

What Partner Center does have is **Notes for certification**, and Microsoft explicitly asks that an
update include "information about the changes made to the extension" there. The paragraph below
carries it.

---

## Notes for certification

Optional text box on the **Submit your extension** page, reached from the **Publish** button. Same
content as the other two listings, plus what changed in this version:

    The source is plain ES modules, unminified and dependency-free; the uploaded zip is exactly
    what is in the repository at the tagged commit. manifest.json intentionally declares both
    background.service_worker and background.scripts — Edge uses the service worker, the same as
    Chrome; the scripts key is there only for Firefox, which loads the same folder unpacked.

    Changes in 1.5.0: tabs hidden by another extension are excluded from every action, and sorting
    now writes tabs back into the strip positions they already occupied instead of packing them
    towards the front of the window. Both are no-ops on Edge, which has no API for hiding tabs, so
    visible behaviour is identical to 1.4.0. No new permissions and no new APIs.
