import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planDuplicateResponse, planDoesSomething, DUPLICATE_ACTIONS } from '../src/lib/watch.js';

const NONE = -1;

function tab(id, url, extra = {}) {
  return {
    id,
    index: id,
    url,
    title: url,
    pinned: false,
    audible: false,
    groupId: NONE,
    windowId: 1,
    ...extra
  };
}

const OPEN = [tab(1, 'https://example.com/docs'), tab(2, 'https://other.com/')];
const NEWTAB = tab(9, 'https://example.com/docs', { index: 9 });
const CONTEXT = { windowTabCount: 3 };

const plan = (action, newTab = NEWTAB, others = OPEN, context = CONTEXT, match = {}) =>
  planDuplicateResponse(newTab, others, { onDuplicate: action, match }, context);

test('"ignore" is the default and never touches anything', () => {
  const p = planDuplicateResponse(NEWTAB, OPEN, {}, CONTEXT);
  assert.equal(p.matched, false);
  assert.equal(planDoesSomething(p), false);
  assert.equal(planDoesSomething(plan('ignore')), false);
});

test('a tab that duplicates nothing is left alone', () => {
  const p = plan('close-new', tab(9, 'https://fresh.com/'));
  assert.equal(p.matched, false);
  assert.equal(planDoesSomething(p), false);
});

test('close-new closes the tab that just opened', () => {
  const p = plan('close-new');
  assert.deepEqual(p.closeTabIds, [9]);
  assert.equal(p.oldTabId, 1);
  assert.equal(p.focusTabId, null);
});

test('close-old keeps the new tab and closes the existing one', () => {
  const p = plan('close-old');
  assert.deepEqual(p.closeTabIds, [1]);
  assert.equal(p.focusTabId, null);
});

test('focus-old switches to the old tab and closes the new one', () => {
  const p = plan('focus-old');
  assert.equal(p.focusTabId, 1);
  assert.equal(p.focusWindowId, 1);
  assert.deepEqual(p.closeTabIds, [9]);
  assert.equal(p.reloadTabId, null);
});

test('focus-old-reload also reloads the old tab', () => {
  const p = plan('focus-old-reload');
  assert.equal(p.focusTabId, 1);
  assert.equal(p.reloadTabId, 1);
  assert.deepEqual(p.closeTabIds, [9]);
});

test('blank and new-tab pages never count as duplicates', () => {
  for (const url of ['about:blank', 'edge://newtab/', '']) {
    const p = plan('close-new', tab(9, url), [tab(1, url)]);
    assert.equal(p.matched, false, `${url} should not match`);
  }
});

test('matching honours the duplicate settings', () => {
  const withFragment = tab(9, 'https://example.com/docs#top');
  // Default ignore-hash treats it as the same page...
  assert.equal(plan('close-new', withFragment).matched, true);
  // ...but exact matching does not.
  assert.equal(plan('close-new', withFragment, OPEN, CONTEXT, { matchMode: 'exact' }).matched, false);
});

test('close-old will not close a protected tab', () => {
  const pinned = [tab(1, 'https://example.com/docs', { pinned: true })];
  const p = plan('close-old', NEWTAB, pinned);
  assert.equal(p.matched, true);
  assert.deepEqual(p.closeTabIds, [], 'the pinned tab survives');
  assert.equal(p.skipped, 'protected');
  assert.equal(planDoesSomething(p), false);
});

test('close-old picks an unprotected duplicate when one exists', () => {
  const both = [
    tab(1, 'https://example.com/docs', { pinned: true }),
    tab(2, 'https://example.com/docs', { index: 2 })
  ];
  const p = plan('close-old', NEWTAB, both);
  assert.deepEqual(p.closeTabIds, [2]);
});

test('a tab alone in its window is never closed', () => {
  for (const action of ['close-new', 'focus-old', 'focus-old-reload']) {
    const p = plan(action, tab(9, 'https://example.com/docs', { windowId: 2 }), OPEN, {
      windowTabCount: 1
    });
    assert.deepEqual(p.closeTabIds, [], `${action} should not close a lone tab`);
    assert.equal(p.skipped, 'sole-tab');
  }
});

test('switching still happens even when the new tab cannot be closed', () => {
  const p = plan('focus-old', tab(9, 'https://example.com/docs', { windowId: 2 }), OPEN, {
    windowTabCount: 1
  });
  assert.equal(p.focusTabId, 1);
  assert.equal(planDoesSomething(p), true);
});

test('a duplicate in the same window wins over one elsewhere', () => {
  const others = [
    tab(1, 'https://example.com/docs', { windowId: 7, index: 0 }),
    tab(2, 'https://example.com/docs', { windowId: 1, index: 5 })
  ];
  assert.equal(plan('focus-old', NEWTAB, others).focusTabId, 2);
});

test('otherwise the leftmost duplicate wins', () => {
  const others = [
    tab(1, 'https://example.com/docs', { windowId: 1, index: 5 }),
    tab(2, 'https://example.com/docs', { windowId: 1, index: 2 })
  ];
  assert.equal(plan('focus-old', NEWTAB, others).focusTabId, 2);
});

test('the new tab is never treated as its own duplicate', () => {
  const p = plan('close-new', NEWTAB, [NEWTAB]);
  assert.equal(p.matched, false);
});

test('every offered action produces a usable plan', () => {
  for (const { id } of DUPLICATE_ACTIONS) {
    const p = plan(id);
    assert.ok(Array.isArray(p.closeTabIds), `${id} returned no closeTabIds`);
    if (id !== 'ignore') assert.equal(p.matched, true, `${id} did not match`);
  }
});
