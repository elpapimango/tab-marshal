import { test } from 'node:test';
import assert from 'node:assert/strict';

import { selectTabs, matchesFilter, prepareReloadOptions, explainEmpty } from '../src/lib/select.js';

const NONE = -1;

function tabs(specs) {
  return specs.map(([id, url, extra = {}], index) => ({
    id,
    index,
    url,
    title: extra.title ?? url,
    pinned: false,
    discarded: false,
    status: 'complete',
    groupId: NONE,
    windowId: 1,
    ...extra
  }));
}

const opts = (o) => prepareReloadOptions(o);

const SAMPLE = tabs([
  [1, 'https://github.com/anthropics/x', { title: 'Repo x' }],
  [2, 'https://www.github.com/anthropics/y', { title: 'Repo y', pinned: true }],
  [3, 'https://news.bbc.co.uk/story', { title: 'BBC story' }],
  [4, 'https://example.com/docs', { title: 'Docs', discarded: true }],
  [5, 'https://example.com/api', { title: 'API', groupId: 7 }]
]);

test('selection "all" returns everything but leaves sleeping tabs alone by default', () => {
  const selected = selectTabs(SAMPLE, opts({ selection: 'all' }));
  assert.deepEqual(selected.map((t) => t.id), [1, 2, 3, 5]);
});

test('sleeping tabs can be included, pinned tabs can be skipped', () => {
  assert.deepEqual(
    selectTabs(SAMPLE, opts({ selection: 'all', skipUnloaded: false })).map((t) => t.id),
    [1, 2, 3, 4, 5]
  );
  assert.deepEqual(
    selectTabs(SAMPLE, opts({ selection: 'all', skipPinned: true })).map((t) => t.id),
    [1, 3, 5]
  );
});

test('selection "active" ignores the skip options', () => {
  // Tab 2 is pinned and would normally be skipped; asking for it explicitly wins.
  const selected = selectTabs(
    SAMPLE,
    opts({ selection: 'active', skipPinned: true }),
    { activeTabId: 2 }
  );
  assert.deepEqual(selected.map((t) => t.id), [2]);
});

test('selection "group" takes the active tab\'s group, or nothing', () => {
  assert.deepEqual(
    selectTabs(SAMPLE, opts({ selection: 'group' }), { activeTabId: 5, activeGroupId: 7 }).map((t) => t.id),
    [5]
  );
  assert.deepEqual(
    selectTabs(SAMPLE, opts({ selection: 'group' }), { activeTabId: 1, activeGroupId: NONE }),
    []
  );
  assert.match(
    explainEmpty({ selection: 'group' }, { activeGroupId: NONE }),
    /not in a tab group/
  );
});

test('filter fields resolve through the same key helpers as sorting', () => {
  const o = opts({ selection: 'filter', field: 'domain', mode: 'equals', value: 'github.com' });
  // www. is stripped by the domain key, so both GitHub tabs match.
  assert.deepEqual(selectTabs(SAMPLE, o).map((t) => t.id), [1, 2]);

  const byHost = opts({ selection: 'filter', field: 'hostname', mode: 'equals', value: 'github.com' });
  assert.deepEqual(selectTabs(SAMPLE, byHost).map((t) => t.id), [1]);
});

test('filter modes: contains, starts with, equals', () => {
  const run = (mode, value, field = 'url') =>
    selectTabs(SAMPLE, opts({ selection: 'filter', field, mode, value })).map((t) => t.id);

  assert.deepEqual(run('contains', 'anthropics'), [1, 2]);
  assert.deepEqual(run('starts', 'https://example.com', 'url'), [5]); // 4 is asleep
  assert.deepEqual(run('equals', 'BBC story', 'title'), [3]);
});

test('filter matching is case-insensitive unless asked otherwise', () => {
  const insensitive = opts({ selection: 'filter', field: 'title', mode: 'contains', value: 'repo' });
  assert.deepEqual(selectTabs(SAMPLE, insensitive).map((t) => t.id), [1, 2]);

  const sensitive = opts({
    selection: 'filter',
    field: 'title',
    mode: 'contains',
    value: 'repo',
    caseSensitive: true
  });
  assert.deepEqual(selectTabs(SAMPLE, sensitive), []);
});

test('regex filters work and report bad patterns', () => {
  const o = opts({ selection: 'filter', field: 'url', mode: 'regex', value: '/(docs|api)$' });
  assert.deepEqual(selectTabs(SAMPLE, o).map((t) => t.id), [5]);

  assert.throws(
    () => prepareReloadOptions({ selection: 'filter', mode: 'regex', value: '([bad' }),
    /Unterminated character class/
  );
  assert.throws(
    () => prepareReloadOptions({ selection: 'filter', mode: 'regex', value: '' }),
    /Enter a pattern/
  );
});

test('an empty filter value matches nothing rather than everything', () => {
  const o = opts({ selection: 'filter', field: 'url', mode: 'contains', value: '' });
  assert.deepEqual(selectTabs(SAMPLE, o), []);
  assert.equal(matchesFilter(SAMPLE[0], { field: 'url', mode: 'contains', value: '' }), false);
  assert.match(explainEmpty({ selection: 'filter', value: '' }), /Enter a value/);
});
