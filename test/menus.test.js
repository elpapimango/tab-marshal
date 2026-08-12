/**
 * The context-menu tree. background.js is not unit tested, so the parts that
 * can drift silently — an item with no handler, a handler with no item — are
 * checked here against the source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  MENU_ITEMS,
  MENU_ROOT,
  MENU_CONTEXTS,
  MENU_FALLBACK_CONTEXTS,
  ANCHORED_ITEMS
} from '../src/lib/menus.js';

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
