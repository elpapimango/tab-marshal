import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findDuplicates, normalizeUrl } from '../src/lib/duplicates.js';
import { TAB_GROUP_ID_NONE } from '../src/lib/sorter.js';

const NONE = TAB_GROUP_ID_NONE;

function tabs(specs) {
  return specs.map(([id, url, extra = {}], index) => ({
    id,
    index,
    url,
    title: extra.title ?? url,
    pinned: false,
    audible: false,
    groupId: NONE,
    windowId: 1,
    ...extra
  }));
}

test('normalizeUrl honours the match mode', () => {
  const url = 'https://www.example.com/path/?q=1#frag';
  assert.equal(
    normalizeUrl(url, { matchMode: 'exact', ignoreWww: false, ignoreTrailingSlash: false }),
    'https://www.example.com/path/?q=1#frag'
  );
  assert.equal(
    normalizeUrl(url, { matchMode: 'ignore-hash', ignoreWww: true, ignoreTrailingSlash: true }),
    'https://example.com/path?q=1'
  );
  assert.equal(
    normalizeUrl(url, { matchMode: 'ignore-query', ignoreWww: true, ignoreTrailingSlash: true }),
    'https://example.com/path'
  );
  assert.equal(
    normalizeUrl(url, { matchMode: 'host-path', ignoreWww: true, ignoreTrailingSlash: true }),
    'example.com/path'
  );
});

test('exact mode does not merge tabs differing by fragment', () => {
  const list = tabs([
    [1, 'https://a.com/x#one'],
    [2, 'https://a.com/x#two']
  ]);
  assert.equal(findDuplicates(list, { matchMode: 'exact' }).closeCount, 0);
  assert.equal(findDuplicates(list, { matchMode: 'ignore-hash' }).closeCount, 1);
});

test('keeps the leftmost tab by default', () => {
  const list = tabs([
    [1, 'https://a.com/x'],
    [2, 'https://b.com/'],
    [3, 'https://a.com/x']
  ]);
  const { sets, closeIds } = findDuplicates(list, {});
  assert.equal(sets.length, 1);
  assert.equal(sets[0].keep.id, 1);
  assert.deepEqual(closeIds, [3]);
});

test('keep: rightmost and most-recently-used', () => {
  const list = tabs([
    [1, 'https://a.com/x', { lastAccessed: 100 }],
    [2, 'https://a.com/x', { lastAccessed: 900 }],
    [3, 'https://a.com/x', { lastAccessed: 500 }]
  ]);
  assert.equal(findDuplicates(list, { keep: 'last' }).sets[0].keep.id, 3);
  assert.equal(findDuplicates(list, { keep: 'mru' }).sets[0].keep.id, 2);
});

test('protected tabs are kept, never closed', () => {
  const list = tabs([
    [1, 'https://a.com/x'],
    [2, 'https://a.com/x', { pinned: true }],
    [3, 'https://a.com/x']
  ]);
  const { sets, closeIds } = findDuplicates(list, { protectPinned: true, keep: 'first' });
  assert.equal(sets[0].keep.id, 2, 'the pinned tab becomes the keeper');
  assert.deepEqual(closeIds.sort(), [1, 3]);
});

test('a set made entirely of protected tabs is skipped', () => {
  const list = tabs([
    [1, 'https://a.com/x', { pinned: true }],
    [2, 'https://a.com/x', { pinned: true }]
  ]);
  assert.equal(findDuplicates(list, { protectPinned: true }).closeCount, 0);
});

test('grouped tabs can be protected', () => {
  const list = tabs([
    [1, 'https://a.com/x'],
    [2, 'https://a.com/x', { groupId: 5 }]
  ]);
  assert.equal(findDuplicates(list, { protectGrouped: true }).sets[0].keep.id, 2);
  assert.deepEqual(findDuplicates(list, { protectGrouped: true }).closeIds, [1]);
});

test('blank and new-tab pages are skipped by default', () => {
  const list = tabs([
    [1, 'about:blank'],
    [2, 'about:blank'],
    [3, 'edge://newtab/'],
    [4, 'edge://newtab/']
  ]);
  assert.equal(findDuplicates(list, {}).closeCount, 0);
  assert.equal(findDuplicates(list, { ignoreBlank: false }).closeCount, 2);
});

test('duplicates are found across windows', () => {
  const list = [
    ...tabs([[1, 'https://a.com/x']]),
    ...tabs([[2, 'https://a.com/x', { windowId: 2 }]])
  ];
  assert.deepEqual(findDuplicates(list, {}).closeIds, [2]);
});

test('www and trailing slash normalisation can be turned off', () => {
  const list = tabs([
    [1, 'https://www.a.com/x/'],
    [2, 'https://a.com/x']
  ]);
  assert.equal(findDuplicates(list, {}).closeCount, 1);
  assert.equal(findDuplicates(list, { ignoreWww: false }).closeCount, 0);
});

test('a non-default port is part of the address', () => {
  // `URL` drops only the scheme's own default port, so https://a.com:80/ still
  // carries one — and it is a different address from https://a.com/. Treating
  // 80 and 443 as always-default folded the two together and closed one of them.
  const list = tabs([
    [1, 'https://a.com/x'],
    [2, 'https://a.com:80/x']
  ]);
  assert.equal(findDuplicates(list, {}).closeCount, 0);

  const alsoHttp = tabs([
    [1, 'http://a.com/x'],
    [2, 'http://a.com:443/x']
  ]);
  assert.equal(findDuplicates(alsoHttp, {}).closeCount, 0);
});

test('a default port written out is still the same address', () => {
  // The other half of the same rule: :443 on https is the default, so `URL`
  // removes it and the two really are one address.
  const list = tabs([
    [1, 'https://a.com/x'],
    [2, 'https://a.com:443/x']
  ]);
  assert.equal(findDuplicates(list, {}).closeCount, 1);
});

test('two tabs on the same non-default port are duplicates', () => {
  const list = tabs([
    [1, 'http://localhost:3000/app'],
    [2, 'http://localhost:3000/app']
  ]);
  assert.equal(findDuplicates(list, {}).closeCount, 1);
});
