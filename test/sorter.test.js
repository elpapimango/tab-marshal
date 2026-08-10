import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getDomain, getHostname, getRegistrableDomain } from '../src/lib/keys.js';
import { planSort, planToTabIds, prepareOptions, TAB_GROUP_ID_NONE } from '../src/lib/sorter.js';

const NONE = TAB_GROUP_ID_NONE;

/** Build a tab list from a compact spec: [id, url, groupId?, extra?] */
function tabs(specs) {
  return specs.map(([id, url, groupId = NONE, extra = {}], index) => ({
    id,
    index,
    url,
    title: extra.title ?? url,
    pinned: extra.pinned ?? false,
    groupId,
    windowId: 1,
    ...extra
  }));
}

const opts = (o) => prepareOptions(o);

test('registrable domain handles multi-label suffixes', () => {
  assert.equal(getRegistrableDomain('www.google.com'), 'google.com');
  assert.equal(getRegistrableDomain('news.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(getRegistrableDomain('a.b.example.com.au'), 'example.com.au');
  assert.equal(getRegistrableDomain('user.github.io'), 'user.github.io');
  assert.equal(getRegistrableDomain('bucket.s3.amazonaws.com'), 'bucket.s3.amazonaws.com');
  assert.equal(getRegistrableDomain('192.168.1.1'), '192.168.1.1');
  assert.equal(getRegistrableDomain('localhost'), 'localhost');
});

test('domain and hostname keys fall back to the scheme for browser pages', () => {
  assert.equal(getDomain('https://www.example.co.uk/a'), 'example.co.uk');
  assert.equal(getHostname('https://www.example.co.uk/a'), 'www.example.co.uk');
  assert.equal(getDomain('edge://settings/profiles'), 'edge');
  assert.equal(getHostname('edge://settings/profiles'), 'edge://settings');
  assert.equal(getHostname('about:blank'), 'about');
});

test('sorts ungrouped tabs by domain', () => {
  const list = tabs([
    [1, 'https://zebra.com/'],
    [2, 'https://apple.com/'],
    [3, 'https://mango.com/']
  ]);
  const plan = planSort(list, [], opts({ primary: 'domain', secondary: 'none' }));
  assert.deepEqual(planToTabIds(plan), [2, 3, 1]);
});

test('descending reverses the primary criterion', () => {
  const list = tabs([
    [1, 'https://apple.com/'],
    [2, 'https://mango.com/'],
    [3, 'https://zebra.com/']
  ]);
  const plan = planSort(list, [], opts({ primary: 'domain', secondary: 'none', descending: true }));
  assert.deepEqual(planToTabIds(plan), [3, 2, 1]);
});

test('secondary criterion breaks ties within a domain', () => {
  const list = tabs([
    [1, 'https://a.com/z', NONE, { title: 'Zulu' }],
    [2, 'https://a.com/a', NONE, { title: 'Alpha' }],
    [3, 'https://b.com/', NONE, { title: 'Bravo' }]
  ]);
  const plan = planSort(list, [], opts({ primary: 'domain', secondary: 'title' }));
  assert.deepEqual(planToTabIds(plan), [2, 1, 3]);
});

test('pinned tabs stay in front and sort among themselves', () => {
  const list = tabs([
    [1, 'https://zebra.com/', NONE, { pinned: true }],
    [2, 'https://apple.com/', NONE, { pinned: true }],
    [3, 'https://beta.com/']
  ]);
  const plan = planSort(list, [], opts({ primary: 'domain', secondary: 'none' }));
  assert.deepEqual(plan.pinned, [2, 1]);
  assert.deepEqual(planToTabIds(plan), [2, 1, 3]);
});

test('tab groups stay contiguous and are ordered by their tabs', () => {
  const list = tabs([
    [1, 'https://mango.com/a', 10],
    [2, 'https://mango.com/b', 10],
    [3, 'https://apple.com/x', 20],
    [4, 'https://apple.com/y', 20],
    [5, 'https://banana.com/']
  ]);
  const groups = [
    { id: 10, title: 'Fruit M', color: 'red' },
    { id: 20, title: 'Fruit A', color: 'blue' }
  ];
  const plan = planSort(list, groups, opts({ primary: 'domain', secondary: 'none' }));
  assert.deepEqual(planToTabIds(plan), [3, 4, 5, 1, 2]);
  assert.deepEqual(
    plan.blocks.map((b) => b.kind),
    ['group', 'tab', 'group']
  );
});

test('groups can be forced to the front and ordered by name', () => {
  const list = tabs([
    [1, 'https://zzz.com/', NONE],
    [2, 'https://mango.com/a', 10],
    [3, 'https://apple.com/x', 20]
  ]);
  const groups = [
    { id: 10, title: 'Work', color: 'red' },
    { id: 20, title: 'Admin', color: 'blue' }
  ];
  const plan = planSort(
    list,
    groups,
    opts({ primary: 'domain', secondary: 'none', groupPlacement: 'first', groupOrderBy: 'title' })
  );
  assert.deepEqual(planToTabIds(plan), [3, 2, 1]);
});

test('target "inside-groups" leaves the block order untouched', () => {
  const list = tabs([
    [1, 'https://zebra.com/', 10],
    [2, 'https://apple.com/', 10],
    [3, 'https://aaa.com/']
  ]);
  const plan = planSort(list, [{ id: 10, title: 'G', color: 'red' }], opts({
    primary: 'domain',
    secondary: 'none',
    target: 'inside-groups'
  }));
  assert.deepEqual(planToTabIds(plan), [2, 1, 3]);
});

test('target "ungrouped" reorders loose tabs only, in their own slots', () => {
  const list = tabs([
    [1, 'https://zebra.com/'],
    [2, 'https://grouped.com/', 10],
    [3, 'https://apple.com/']
  ]);
  const plan = planSort(list, [{ id: 10, title: 'G', color: 'red' }], opts({
    primary: 'domain',
    secondary: 'none',
    target: 'ungrouped'
  }));
  // The group keeps its middle slot; the loose tabs swap.
  assert.deepEqual(planToTabIds(plan), [3, 2, 1]);
});

test('regex sorts on the first capture group and parks non-matches at the end', () => {
  const list = tabs([
    [1, 'https://tracker.example.com/issue/DEV-42'],
    [2, 'https://tracker.example.com/issue/ABC-7'],
    [3, 'https://example.com/no-ticket']
  ]);
  const plan = planSort(
    list,
    [],
    opts({ primary: 'regex', secondary: 'none', regexPattern: '/issue/([A-Z]+)-', regexSource: 'url' })
  );
  assert.deepEqual(planToTabIds(plan), [2, 1, 3]);
});

test('regex non-matches stay last even when descending', () => {
  const list = tabs([
    [1, 'https://x.com/a/1'],
    [2, 'https://x.com/nope'],
    [3, 'https://x.com/a/2']
  ]);
  const plan = planSort(
    list,
    [],
    opts({ primary: 'regex', secondary: 'none', descending: true, regexPattern: '/a/(\\d+)' })
  );
  assert.deepEqual(planToTabIds(plan), [3, 1, 2]);
});

test('numeric-aware comparison keeps 2 before 10', () => {
  const list = tabs([
    [1, 'https://x.com/page10'],
    [2, 'https://x.com/page2']
  ]);
  const plan = planSort(list, [], opts({ primary: 'url', secondary: 'none' }));
  assert.deepEqual(planToTabIds(plan), [2, 1]);
});

test('an invalid regular expression is reported clearly', () => {
  assert.throws(
    () => prepareOptions({ primary: 'regex', regexPattern: '([unclosed' }),
    /Invalid regular expression/
  );
});

test('sorting is idempotent', () => {
  const list = tabs([
    [1, 'https://mango.com/b', 10],
    [2, 'https://apple.com/x', 20],
    [3, 'https://banana.com/'],
    [4, 'https://mango.com/a', 10]
  ]);
  const groups = [
    { id: 10, title: 'M', color: 'red' },
    { id: 20, title: 'A', color: 'blue' }
  ];
  const o = opts({ primary: 'domain', secondary: 'url' });
  const first = planToTabIds(planSort(list, groups, o));

  const reordered = first.map((id, index) => {
    const tab = list.find((t) => t.id === id);
    return { ...tab, index };
  });
  const second = planToTabIds(planSort(reordered, groups, o));
  assert.deepEqual(second, first);
});
