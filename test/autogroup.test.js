import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GROUP_COLORS,
  matchRule,
  colorForName,
  prepareAutoGroupRules,
  planGroupAssignments
} from '../src/lib/autogroup.js';

const NONE = -1;

function tabs(specs) {
  return specs.map(([id, url, extra = {}], index) => ({
    id,
    index,
    url,
    title: extra.title ?? url,
    pinned: false,
    groupId: NONE,
    windowId: 1,
    ...extra
  }));
}

function rule(overrides) {
  return { field: 'domain', mode: 'contains', value: '', caseSensitive: false, groupName: '', color: '', ...overrides };
}

test('first matching rule wins, in list order', () => {
  const rules = prepareAutoGroupRules([
    rule({ value: 'github.com', groupName: 'Broad' }),
    rule({ value: 'github.com', groupName: 'Narrow' })
  ]);
  const [tab] = tabs([[1, 'https://github.com/a']]);
  assert.equal(matchRule(tab, rules).groupName, 'Broad');
});

test('a rule with no pattern or no group name never matches', () => {
  const rules = prepareAutoGroupRules([rule({ value: '', groupName: 'X' }), rule({ value: 'github.com', groupName: '' })]);
  const [tab] = tabs([[1, 'https://github.com/a']]);
  assert.equal(matchRule(tab, rules), null);
});

test('regex mode matches against the URL, case-insensitively by default', () => {
  const rules = prepareAutoGroupRules([rule({ field: 'url', mode: 'regex', value: '^https://DOCS\\.', groupName: 'Docs' })]);
  const [tab] = tabs([[1, 'https://docs.example.com/']]);
  assert.equal(matchRule(tab, rules).groupName, 'Docs');
});

test('an invalid regex throws a readable error', () => {
  assert.throws(() => prepareAutoGroupRules([rule({ mode: 'regex', value: '(', groupName: 'X' })]), /\(/);
});

test('domain/hostname/url/path/title fields all resolve through the shared filter', () => {
  const [tab] = tabs([[1, 'https://news.bbc.co.uk/story', { title: 'BBC story' }]]);
  assert.equal(matchRule(tab, prepareAutoGroupRules([rule({ field: 'domain', value: 'bbc.co.uk', groupName: 'G' })])).groupName, 'G');
  assert.equal(matchRule(tab, prepareAutoGroupRules([rule({ field: 'hostname', value: 'news.bbc.co.uk', groupName: 'G' })])).groupName, 'G');
  assert.equal(matchRule(tab, prepareAutoGroupRules([rule({ field: 'url', value: '/story', groupName: 'G' })])).groupName, 'G');
  assert.equal(matchRule(tab, prepareAutoGroupRules([rule({ field: 'path', value: 'news.bbc.co.uk/story', groupName: 'G' })])).groupName, 'G');
  assert.equal(matchRule(tab, prepareAutoGroupRules([rule({ field: 'title', value: 'BBC', groupName: 'G' })])).groupName, 'G');
});

test('colorForName is deterministic and always a valid colour', () => {
  const a = colorForName('Work');
  const b = colorForName('Work');
  assert.equal(a, b);
  assert.ok(GROUP_COLORS.includes(a));
  // Different names are not guaranteed different colours, but every name must
  // resolve to something in the fixed palette.
  for (const name of ['Shopping', 'News', 'Docs', '']) {
    assert.ok(GROUP_COLORS.includes(colorForName(name)));
  }
});

test('planGroupAssignments groups matching tabs and skips unmatched ones', () => {
  const rules = [rule({ value: 'github.com', groupName: 'Dev', color: 'blue' })];
  const list = tabs([
    [1, 'https://github.com/a'],
    [2, 'https://example.com/'],
    [3, 'https://github.com/b']
  ]);
  const plan = planGroupAssignments(list, rules, new Map());
  assert.deepEqual(
    plan.map((p) => p.tabId),
    [1, 3]
  );
  assert.deepEqual(plan[0], { tabId: 1, groupTitle: 'Dev', color: 'blue', existingGroupId: null });
});

test('a tab already sitting in the right group is left out of the plan', () => {
  const rules = [rule({ value: 'github.com', groupName: 'Dev' })];
  const list = tabs([[1, 'https://github.com/a', { groupId: 42 }]]);
  const existing = new Map([['dev', { id: 42, title: 'Dev' }]]);
  assert.deepEqual(planGroupAssignments(list, rules, existing), []);
});

test('a tab in the wrong existing group is reassigned to the matching one', () => {
  const rules = [rule({ value: 'github.com', groupName: 'Dev' })];
  const list = tabs([[1, 'https://github.com/a', { groupId: 7 }]]);
  const existing = new Map([['dev', { id: 42, title: 'Dev' }]]);
  const plan = planGroupAssignments(list, rules, existing);
  assert.deepEqual(plan, [{ tabId: 1, groupTitle: 'Dev', color: colorForNameOf('Dev'), existingGroupId: 42 }]);
});

function colorForNameOf(name) {
  return colorForName(name);
}

test('group title matching is case-insensitive against existing groups', () => {
  const rules = [rule({ value: 'github.com', groupName: 'dev' })];
  const list = tabs([[1, 'https://github.com/a', { groupId: 42 }]]);
  const existing = new Map([['dev', { id: 42, title: 'Dev' }]]);
  assert.deepEqual(planGroupAssignments(list, rules, existing), []);
});
