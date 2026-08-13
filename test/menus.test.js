/**
 * The context-menu tree. background.js is not unit tested, so the parts that
 * can drift silently — an item with no handler, a handler with no item — are
 * checked here against the source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  MENU_ITEMS,
  MENU_ROOT,
  MENU_CONTEXTS,
  MENU_FALLBACK_CONTEXTS,
  MENU_ICONS,
  ANCHORED_ITEMS,
  menuIconPaths
} from '../src/lib/menus.js';

const repoFile = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

const BACKGROUND = readFileSync(fileURLToPath(new URL('../src/background.js', import.meta.url)), 'utf8');

test('every item has a unique id', () => {
  const ids = MENU_ITEMS.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate menu ids would make create() fail');
  assert.equal(ids.includes(MENU_ROOT), false, 'the root id must not be reused by a child');
});

test('every clickable item has a title, every separator has none', () => {
  for (const item of MENU_ITEMS) {
    if (item.type === 'separator') assert.equal(item.title, undefined, `${item.id} is a separator with a title`);
    else assert.ok(item.title, `${item.id} has no title`);
  }
});

test('every clickable item is handled in background.js', () => {
  for (const item of MENU_ITEMS) {
    if (item.type === 'separator') continue;
    assert.match(
      BACKGROUND,
      new RegExp(`case '${item.id}'`),
      `menu item "${item.id}" has no case in the click handler`
    );
  }
});

test('no handler exists for an item that was removed from the menu', () => {
  const handled = [...BACKGROUND.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]);
  const known = new Set(MENU_ITEMS.map((i) => i.id));
  // The command names are handled with if/else, not case, so anything matched
  // here really is a menu id.
  for (const id of handled) {
    assert.ok(known.has(id), `background.js handles "${id}", which is not in MENU_ITEMS`);
  }
});

test('the tab context is requested, with a toolbar-only fallback', () => {
  assert.ok(MENU_CONTEXTS.includes('tab'), 'the point is to appear on a right-clicked tab');
  assert.ok(MENU_CONTEXTS.includes('action'), 'the toolbar menu must stay');
  assert.deepEqual(MENU_FALLBACK_CONTEXTS, ['action']);
  assert.equal(
    MENU_FALLBACK_CONTEXTS.includes('tab'),
    false,
    'the fallback exists for browsers that reject the tab context'
  );
});

test('anchored items are the ones whose wording refers to "this" tab', () => {
  for (const item of MENU_ITEMS) {
    if (item.type === 'separator') continue;
    const saysThis = /\bthis\b/i.test(item.title);
    assert.equal(
      ANCHORED_ITEMS.has(item.id),
      saysThis,
      `"${item.title}" ${saysThis ? 'reads as tab-specific but is not anchored' : 'is anchored but does not say so'}`
    );
  }
});

test('anchored items pass the clicked tab through', () => {
  // Each anchored handler must forward `anchor`, or it would silently act on
  // the active tab instead of the right-clicked one.
  for (const id of ANCHORED_ITEMS) {
    const block = BACKGROUND.slice(BACKGROUND.indexOf(`case '${id}'`));
    const upToNextCase = block.slice(0, block.indexOf('case ', 5));
    assert.match(upToNextCase, /anchor/, `"${id}" does not use the clicked tab`);
  }
});


/* ---- menu icons ------------------------------------------------------- */

test('every clickable item names a glyph that exists', () => {
  for (const item of MENU_ITEMS) {
    if (item.type === 'separator') continue;
    assert.ok(item.icon, `${item.id} has no icon`);
    assert.ok(MENU_ICONS.includes(item.icon), `${item.id} uses unknown glyph "${item.icon}"`);
  }
});

test('both colour-scheme variants are on disk for every glyph', () => {
  for (const icon of MENU_ICONS) {
    for (const dark of [false, true]) {
      const paths = menuIconPaths(icon, dark);
      for (const size of Object.keys(paths)) {
        assert.ok(
          existsSync(repoFile(paths[size])),
          `${paths[size]} is referenced but missing — run npm run icons:menu`
        );
      }
    }
  }
});

test('the two variants are different files, and named for the scheme they suit', () => {
  for (const icon of MENU_ICONS) {
    const light = menuIconPaths(icon, false)[16];
    const dark = menuIconPaths(icon, true)[16];
    assert.notEqual(light, dark, `${icon} would look identical in both schemes`);
    assert.match(light, /-light\.svg$/);
    assert.match(dark, /-dark\.svg$/);
  }
});

test('the dark-scheme glyph is the light-coloured one', () => {
  // Named for where it is used, not for its ink — easy to get backwards.
  const onDarkMenu = readFileSync(repoFile(menuIconPaths('sort', true)[16]), 'utf8');
  const onLightMenu = readFileSync(repoFile(menuIconPaths('sort', false)[16]), 'utf8');
  assert.match(onDarkMenu, /stroke="#f/i, 'a dark menu needs pale ink');
  assert.match(onLightMenu, /stroke="#1/i, 'a light menu needs dark ink');
});

test('separators carry no icon', () => {
  for (const item of MENU_ITEMS) {
    if (item.type === 'separator') assert.equal(menuIconPaths(item.icon, false), undefined);
  }
});

/* ---- release hygiene --------------------------------------------------- */

test('manifest and package.json carry the same version', () => {
  // They drifted once already: a release bumped the manifest and left
  // package.json a version behind, which the zip filename is built from.
  const manifest = JSON.parse(readFileSync(repoFile('manifest.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(repoFile('package.json'), 'utf8'));
  assert.equal(pkg.version, manifest.version);
});
