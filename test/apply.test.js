/**
 * Exercises apply.js against a fake tab strip. The planner is covered by
 * sorter.test.js; what matters here is that walking the strip with a cursor
 * really produces the planned order, keeps tab groups contiguous, and that undo
 * puts everything back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const NONE = -1;

/** Minimal stand-in for the parts of chrome.* that apply.js uses. */
function makeFakeChrome(initial, { failReload = [], windowType = 'normal' } = {}) {
  let strip = initial.map((t, i) => ({ ...t, index: i, windowId: t.windowId ?? 1 }));
  const session = {};
  const reloads = [];
  const activated = [];
  const highlights = [];
  let nextId = 1000;
  const unreloadable = new Set(failReload);
  const reindex = () => strip.forEach((t, i) => (t.index = i));

  const chrome = {
    _strip: () => strip.map((t) => t.id),
    _tabs: () => strip.map((t) => ({ ...t })),
    _reloads: () => reloads.map((r) => ({ ...r })),
    _activated: () => [...activated],
    _highlights: () => highlights.map((h) => ({ ...h })),
    windows: {
      getCurrent: async () => ({ id: 1 }),
      getAll: async () => [{ id: 1 }],
      get: async (id) => ({ id, type: windowType }),
      update: async () => {}
    },
    tabs: {
      query: async (q = {}) => {
        let list = strip.map((t) => ({ ...t }));
        if (q.active) list = list.filter((t) => t.active);
        if (q.windowId !== undefined) list = list.filter((t) => t.windowId === q.windowId);
        return list;
      },
      reload: async (id, options = {}) => {
        if (unreloadable.has(id)) throw new Error('cannot reload this page');
        reloads.push({ id, bypassCache: !!options.bypassCache });
      },
      highlight: async ({ windowId, tabs: indices }) => {
        if (!Array.isArray(indices) || indices.length === 0) throw new Error('no tabs to highlight');
        highlights.push({ windowId, indices: [...indices] });
        // The browser makes the first entry active and drops the rest of the
        // previous selection.
        strip.forEach((t) => {
          t.highlighted = indices.includes(t.index);
          t.active = t.index === indices[0];
        });
      },
      duplicate: async (id) => {
        const from = strip.findIndex((t) => t.id === id);
        if (from === -1) throw new Error(`no such tab ${id}`);
        const copy = { ...strip[from], id: nextId++, active: false };
        strip.splice(from + 1, 0, copy);
        reindex();
        return { ...copy };
      },
      get: async (id) => {
        const found = strip.find((t) => t.id === id);
        if (!found) throw new Error(`no such tab ${id}`);
        return { ...found };
      },
      update: async (id, options = {}) => {
        if (options.active) activated.push(id);
        return { id };
      },
      move: async (id, { index }) => {
        const from = strip.findIndex((t) => t.id === id);
        if (from === -1) throw new Error(`no such tab ${id}`);
        const [tab] = strip.splice(from, 1);
        strip.splice(Math.min(index, strip.length), 0, tab);
        reindex();
      },
      remove: async (ids) => {
        const set = new Set([].concat(ids));
        strip = strip.filter((t) => !set.has(t.id));
        reindex();
      }
    },
    tabGroups: {
      query: async () => {
        const seen = new Map();
        for (const t of strip) {
          if (t.groupId !== NONE && !seen.has(t.groupId)) {
            seen.set(t.groupId, { id: t.groupId, title: `G${t.groupId}`, color: 'blue' });
          }
        }
        return [...seen.values()];
      },
      move: async (groupId, { index }) => {
        const members = strip.filter((t) => t.groupId === groupId);
        assertContiguous(strip, groupId);
        strip = strip.filter((t) => t.groupId !== groupId);
        strip.splice(Math.min(index, strip.length), 0, ...members);
        reindex();
      }
    },
    storage: {
      session: {
        get: async (key) => (session[key] === undefined ? {} : { [key]: session[key] }),
        set: async (obj) => Object.assign(session, obj)
      }
    }
  };
  return chrome;
}

function assertContiguous(strip, groupId) {
  const idx = strip.map((t, i) => (t.groupId === groupId ? i : -1)).filter((i) => i !== -1);
  for (let i = 1; i < idx.length; i++) {
    assert.equal(idx[i], idx[i - 1] + 1, `group ${groupId} is not contiguous: ${idx}`);
  }
}

function assertAllGroupsContiguous(chrome) {
  const ids = new Set(chrome._tabs().map((t) => t.groupId).filter((g) => g !== NONE));
  for (const id of ids) assertContiguous(chrome._tabs(), id);
}

/** apply.js reads `chrome` at import time, so install the fake first. */
async function withFakeChrome(initial, fn, options) {
  const chrome = makeFakeChrome(initial, options);
  globalThis.chrome = chrome;
  const apply = await import(`../src/lib/apply.js?t=${Math.random()}`);
  try {
    return await fn(apply, chrome);
  } finally {
    delete globalThis.chrome;
  }
}

const settings = (sort = {}, duplicates = {}, reload = {}, watch = {}, select = {}) => ({
  scope: 'window',
  sort: { primary: 'domain', secondary: 'none', target: 'all', groupPlacement: 'interleave', groupOrderBy: 'tabs', ...sort },
  duplicates: { ...duplicates },
  reload: { delayMs: 0, ...reload },
  watch: { onDuplicate: 'ignore', ...watch },
  select: { selection: 'all', field: 'domain', mode: 'contains', value: '', skipPinned: false, skipUnloaded: false, ...select }
});

test('sorting a flat strip reorders it', async () => {
  await withFakeChrome(
    [
      { id: 1, url: 'https://zebra.com/', title: 'z', pinned: false, groupId: NONE },
      { id: 2, url: 'https://apple.com/', title: 'a', pinned: false, groupId: NONE },
      { id: 3, url: 'https://mango.com/', title: 'm', pinned: false, groupId: NONE }
    ],
    async (apply, chrome) => {
      await apply.sortTabs(settings());
      assert.deepEqual(chrome._strip(), [2, 3, 1]);
    }
  );
});

test('groups stay contiguous and pinned tabs stay in front', async () => {
  await withFakeChrome(
    [
      { id: 1, url: 'https://zzz.com/', title: 'z', pinned: true, groupId: NONE },
      { id: 2, url: 'https://aaa.com/', title: 'a', pinned: true, groupId: NONE },
      { id: 3, url: 'https://mango.com/b', title: 'mb', pinned: false, groupId: 10 },
      { id: 4, url: 'https://mango.com/a', title: 'ma', pinned: false, groupId: 10 },
      { id: 5, url: 'https://banana.com/', title: 'b', pinned: false, groupId: NONE },
      { id: 6, url: 'https://apple.com/y', title: 'ay', pinned: false, groupId: 20 },
      { id: 7, url: 'https://apple.com/x', title: 'ax', pinned: false, groupId: 20 }
    ],
    async (apply, chrome) => {
      await apply.sortTabs(settings({ secondary: 'url' }));
      // pinned aaa, zzz | apple group | banana | mango group
      assert.deepEqual(chrome._strip(), [2, 1, 7, 6, 5, 4, 3]);
      assertAllGroupsContiguous(chrome);
    }
  );
});

test('groups can be pushed to the end without breaking up', async () => {
  await withFakeChrome(
    [
      { id: 1, url: 'https://a.com/1', title: '1', pinned: false, groupId: 10 },
      { id: 2, url: 'https://z.com/', title: 'z', pinned: false, groupId: NONE },
      { id: 3, url: 'https://a.com/2', title: '2', pinned: false, groupId: 10 },
      { id: 4, url: 'https://b.com/', title: 'b', pinned: false, groupId: NONE }
    ],
    async (apply, chrome) => {
      await apply.sortTabs(settings({ groupPlacement: 'last', secondary: 'url' }));
      assert.deepEqual(chrome._strip(), [4, 2, 1, 3]);
      assertAllGroupsContiguous(chrome);
    }
  );
});

test('sorting twice changes nothing the second time', async () => {
  await withFakeChrome(
    [
      { id: 1, url: 'https://c.com/', title: 'c', pinned: false, groupId: NONE },
      { id: 2, url: 'https://a.com/x', title: 'x', pinned: false, groupId: 10 },
      { id: 3, url: 'https://b.com/', title: 'b', pinned: false, groupId: NONE },
      { id: 4, url: 'https://a.com/y', title: 'y', pinned: false, groupId: 10 }
    ],
    async (apply, chrome) => {
      await apply.sortTabs(settings({ secondary: 'url' }));
      const once = chrome._strip();
      await apply.sortTabs(settings({ secondary: 'url' }));
      assert.deepEqual(chrome._strip(), once);
    }
  );
});

test('undo restores the previous order', async () => {
  // Group members must start out adjacent — the browser never allows otherwise.
  const initial = [
    { id: 1, url: 'https://zebra.com/', title: 'z', pinned: false, groupId: NONE },
    { id: 2, url: 'https://apple.com/a', title: 'a', pinned: false, groupId: 10 },
    { id: 4, url: 'https://apple.com/b', title: 'b', pinned: false, groupId: 10 },
    { id: 3, url: 'https://mango.com/', title: 'm', pinned: false, groupId: NONE }
  ];
  await withFakeChrome(initial, async (apply, chrome) => {
    const before = chrome._strip();
    await apply.sortTabs(settings({ secondary: 'url' }));
    assert.notDeepEqual(chrome._strip(), before);
    assert.equal(await apply.hasUndo(settings()), true);

    const result = await apply.undoSort(settings());
    assert.equal(result.ok, true);
    assert.deepEqual(chrome._strip(), before);
    assert.equal(await apply.hasUndo(settings()), false, 'undo is consumed');
  });
});

test('undo reports when there is nothing to undo', async () => {
  await withFakeChrome([{ id: 1, url: 'https://a.com/', title: 'a', pinned: false, groupId: NONE }], async (apply) => {
    const result = await apply.undoSort(settings());
    assert.equal(result.ok, false);
    assert.match(result.message, /Nothing to undo/);
  });
});

test('undo tolerates tabs closed since the sort', async () => {
  await withFakeChrome(
    [
      { id: 1, url: 'https://c.com/', title: 'c', pinned: false, groupId: NONE },
      { id: 2, url: 'https://a.com/', title: 'a', pinned: false, groupId: NONE },
      { id: 3, url: 'https://b.com/', title: 'b', pinned: false, groupId: NONE }
    ],
    async (apply, chrome) => {
      await apply.sortTabs(settings());
      assert.deepEqual(chrome._strip(), [2, 3, 1]);
      await chrome.tabs.remove(3);
      await apply.undoSort(settings());
      assert.deepEqual(chrome._strip(), [1, 2]);
    }
  );
});

test('closeDuplicates removes only the duplicates', async () => {
  await withFakeChrome(
    [
      { id: 1, url: 'https://a.com/x', title: 'x', pinned: false, groupId: NONE },
      { id: 2, url: 'https://b.com/', title: 'b', pinned: false, groupId: NONE },
      { id: 3, url: 'https://a.com/x#frag', title: 'x', pinned: false, groupId: NONE },
      { id: 4, url: 'https://a.com/x', title: 'x', pinned: false, groupId: NONE }
    ],
    async (apply, chrome) => {
      const preview = await apply.previewDuplicates(settings());
      assert.equal(preview.closeCount, 2);
      assert.deepEqual(chrome._strip(), [1, 2, 3, 4], 'preview must not change anything');

      const result = await apply.closeDuplicates(settings());
      assert.equal(result.closed, 2);
      assert.deepEqual(chrome._strip(), [1, 2]);
    }
  );
});

const RELOAD_STRIP = [
  { id: 1, url: 'https://github.com/a', title: 'A', pinned: true, groupId: NONE, discarded: false, active: false },
  { id: 2, url: 'https://github.com/b', title: 'B', pinned: false, groupId: 5, discarded: false, active: true },
  { id: 3, url: 'https://example.com/', title: 'C', pinned: false, groupId: 5, discarded: false, active: false },
  { id: 4, url: 'https://sleepy.com/', title: 'D', pinned: false, groupId: NONE, discarded: true, active: false }
];

test('reload hits every awake tab by default', async () => {
  await withFakeChrome(RELOAD_STRIP, async (apply, chrome) => {
    const result = await apply.reloadTabs(settings({}, {}, { selection: 'all' }));
    assert.equal(result.reloaded, 3);
    assert.deepEqual(chrome._reloads().map((r) => r.id), [1, 2, 3], 'the sleeping tab stays asleep');
    assert.match(result.message, /Reloaded 3 tabs/);
  });
});

test('reload can skip pinned tabs and wake sleeping ones', async () => {
  await withFakeChrome(RELOAD_STRIP, async (apply, chrome) => {
    await apply.reloadTabs(
      settings({}, {}, { selection: 'all', skipPinned: true, skipUnloaded: false })
    );
    assert.deepEqual(chrome._reloads().map((r) => r.id), [2, 3, 4]);
  });
});

test('reload targets the active tab, its group, or a filter', async () => {
  await withFakeChrome(RELOAD_STRIP, async (apply, chrome) => {
    await apply.reloadTabs(settings({}, {}, { selection: 'active' }));
    assert.deepEqual(chrome._reloads().map((r) => r.id), [2]);
  });

  await withFakeChrome(RELOAD_STRIP, async (apply, chrome) => {
    await apply.reloadTabs(settings({}, {}, { selection: 'group' }));
    assert.deepEqual(chrome._reloads().map((r) => r.id), [2, 3]);
  });

  await withFakeChrome(RELOAD_STRIP, async (apply, chrome) => {
    await apply.reloadTabs(
      settings({}, {}, { selection: 'filter', field: 'domain', mode: 'equals', value: 'github.com' })
    );
    assert.deepEqual(chrome._reloads().map((r) => r.id), [1, 2]);
  });
});

test('bypassCache is passed through to the browser', async () => {
  await withFakeChrome(RELOAD_STRIP, async (apply, chrome) => {
    const result = await apply.reloadTabs(
      settings({}, {}, { selection: 'active', bypassCache: true })
    );
    assert.deepEqual(chrome._reloads(), [{ id: 2, bypassCache: true }]);
    assert.match(result.message, /cache bypassed/);
  });
});

test('tabs the browser refuses to reload are counted as skipped', async () => {
  await withFakeChrome(
    RELOAD_STRIP,
    async (apply, chrome) => {
      const result = await apply.reloadTabs(settings({}, {}, { selection: 'all' }));
      assert.equal(result.reloaded, 2);
      assert.match(result.message, /1 skipped/);
      assert.deepEqual(chrome._reloads().map((r) => r.id), [1, 3]);
    },
    { failReload: [2] }
  );
});

test('previewReload reports the selection without reloading anything', async () => {
  await withFakeChrome(RELOAD_STRIP, async (apply, chrome) => {
    const preview = await apply.previewReload(settings({}, {}, { selection: 'all' }));
    assert.equal(preview.count, 3);
    assert.deepEqual(chrome._reloads(), []);
  });
});

test('an empty selection explains itself instead of reloading', async () => {
  await withFakeChrome(RELOAD_STRIP, async (apply, chrome) => {
    const result = await apply.reloadTabs(
      settings({}, {}, { selection: 'filter', field: 'domain', mode: 'equals', value: 'nowhere.test' })
    );
    assert.equal(result.ok, false);
    assert.equal(result.reloaded, 0);
    assert.match(result.message, /No tabs match/);
    assert.deepEqual(chrome._reloads(), []);
  });
});

// windowId matters here: the sole-tab-in-window guard depends on it, and a real
// chrome.tabs.Tab always carries one.
const WATCH_STRIP = [
  { id: 1, url: 'https://example.com/docs', title: 'Docs', pinned: false, groupId: NONE, windowId: 1 },
  { id: 2, url: 'https://other.com/', title: 'Other', pinned: false, groupId: NONE, windowId: 1 },
  { id: 3, url: 'https://example.com/docs', title: 'Docs', pinned: false, groupId: NONE, windowId: 1 }
];
const newTab = () => ({ ...WATCH_STRIP[2], index: 2 });

test('the watch does nothing while set to ignore', async () => {
  await withFakeChrome(WATCH_STRIP, async (apply, chrome) => {
    const result = await apply.respondToNewTab(newTab(), settings());
    assert.equal(result.acted, false);
    assert.deepEqual(chrome._strip(), [1, 2, 3]);
  });
});

test('close-new removes the duplicate that just opened', async () => {
  await withFakeChrome(WATCH_STRIP, async (apply, chrome) => {
    const result = await apply.respondToNewTab(newTab(), settings({}, {}, {}, { onDuplicate: 'close-new' }));
    assert.equal(result.acted, true);
    assert.deepEqual(chrome._strip(), [1, 2]);
  });
});

test('close-old removes the existing tab and keeps the new one', async () => {
  await withFakeChrome(WATCH_STRIP, async (apply, chrome) => {
    await apply.respondToNewTab(newTab(), settings({}, {}, {}, { onDuplicate: 'close-old' }));
    assert.deepEqual(chrome._strip(), [2, 3]);
  });
});

test('focus-old activates the old tab and closes the new one', async () => {
  await withFakeChrome(WATCH_STRIP, async (apply, chrome) => {
    await apply.respondToNewTab(newTab(), settings({}, {}, {}, { onDuplicate: 'focus-old' }));
    assert.deepEqual(chrome._activated(), [1]);
    assert.deepEqual(chrome._reloads(), []);
    assert.deepEqual(chrome._strip(), [1, 2]);
  });
});

test('focus-old-reload also reloads the tab it switches to', async () => {
  await withFakeChrome(WATCH_STRIP, async (apply, chrome) => {
    await apply.respondToNewTab(newTab(), settings({}, {}, {}, { onDuplicate: 'focus-old-reload' }));
    assert.deepEqual(chrome._activated(), [1]);
    assert.deepEqual(chrome._reloads().map((r) => r.id), [1]);
    assert.deepEqual(chrome._strip(), [1, 2]);
  });
});

test('a pinned original is protected from close-old', async () => {
  const pinnedFirst = [{ ...WATCH_STRIP[0], pinned: true }, WATCH_STRIP[1], WATCH_STRIP[2]];
  await withFakeChrome(pinnedFirst, async (apply, chrome) => {
    const result = await apply.respondToNewTab(newTab(), settings({}, {}, {}, { onDuplicate: 'close-old' }));
    assert.equal(result.acted, false);
    assert.deepEqual(chrome._strip(), [1, 2, 3], 'nothing is closed');
  });
});

test('the watch ignores tabs in popup windows', async () => {
  await withFakeChrome(
    WATCH_STRIP,
    async (apply, chrome) => {
      const result = await apply.respondToNewTab(newTab(), settings({}, {}, {}, { onDuplicate: 'close-new' }));
      assert.equal(result.acted, false);
      assert.deepEqual(chrome._strip(), [1, 2, 3]);
    },
    { windowType: 'popup' }
  );
});

test('a new tab that duplicates nothing survives', async () => {
  const unique = [WATCH_STRIP[0], WATCH_STRIP[1], { ...WATCH_STRIP[2], url: 'https://fresh.com/' }];
  await withFakeChrome(unique, async (apply, chrome) => {
    const result = await apply.respondToNewTab(
      { ...unique[2], index: 2, windowId: 1 },
      settings({}, {}, {}, { onDuplicate: 'close-new' })
    );
    assert.equal(result.acted, false);
    assert.deepEqual(chrome._strip(), [1, 2, 3]);
  });
});

test('duplicateActiveTab copies the active tab next to it', async () => {
  await withFakeChrome(
    [
      { id: 1, url: 'https://a.com/', title: 'A', pinned: false, groupId: NONE, active: false },
      { id: 2, url: 'https://b.com/', title: 'B', pinned: false, groupId: NONE, active: true },
      { id: 3, url: 'https://c.com/', title: 'C', pinned: false, groupId: NONE, active: false }
    ],
    async (apply, chrome) => {
      const result = await apply.duplicateActiveTab();
      assert.equal(result.ok, true);
      const strip = chrome._strip();
      assert.equal(strip.length, 4);
      assert.deepEqual(strip.slice(0, 2), [1, 2]);
      assert.equal(strip[3], 3, 'the copy lands immediately after its original');

      const copy = chrome._tabs()[2];
      assert.equal(copy.url, 'https://b.com/', 'the copy points at the same page');
      assert.notEqual(copy.id, 2);
    }
  );
});

test('duplicateActiveTab says so when there is no active tab', async () => {
  await withFakeChrome(
    [{ id: 1, url: 'https://a.com/', title: 'A', pinned: false, groupId: NONE, active: false }],
    async (apply, chrome) => {
      const result = await apply.duplicateActiveTab();
      assert.equal(result.ok, false);
      assert.match(result.message, /No active tab/);
      assert.equal(chrome._strip().length, 1);
    }
  );
});

const SELECT_STRIP = [
  { id: 1, url: 'https://github.com/a', title: 'GH a', pinned: true, groupId: NONE, windowId: 1, active: false },
  { id: 2, url: 'https://mozilla.org/x', title: 'MDN x', pinned: false, groupId: 5, windowId: 1, active: true },
  { id: 3, url: 'https://mozilla.org/y', title: 'MDN y', pinned: false, groupId: 5, windowId: 1, active: false },
  { id: 4, url: 'https://github.com/a', title: 'GH a', pinned: false, groupId: NONE, windowId: 1, active: false }
];

test('selecting highlights by index, not by tab id', async () => {
  await withFakeChrome(SELECT_STRIP, async (apply, chrome) => {
    const result = await apply.applySelection(
      settings({}, {}, {}, {}, { selection: 'filter', field: 'domain', mode: 'contains', value: 'mozilla.org' })
    );
    assert.equal(result.selected, 2);
    const [call] = chrome._highlights();
    assert.equal(call.windowId, 1);
    // Tabs 2 and 3 sit at indices 1 and 2 — ids would have been 2 and 3, which
    // happens to differ, so this catches passing ids by mistake.
    assert.deepEqual([...call.indices].sort(), [1, 2]);
  });
});

test('the active tab leads the selection so focus does not jump', async () => {
  await withFakeChrome(SELECT_STRIP, async (apply, chrome) => {
    await apply.applySelection(
      settings({}, {}, {}, {}, { selection: 'filter', field: 'domain', mode: 'contains', value: 'mozilla.org' })
    );
    const [call] = chrome._highlights();
    assert.equal(call.indices[0], 1, 'the already-active tab should be first');
    assert.equal(chrome._tabs().find((t) => t.active).id, 2, 'focus stayed put');
  });
});

test('selecting duplicates picks the extra copies only', async () => {
  await withFakeChrome(SELECT_STRIP, async (apply, chrome) => {
    const preview = await apply.previewSelection(settings({}, {}, {}, {}, { selection: 'duplicates' }));
    // Tabs 1 and 4 are the same URL; 1 is pinned so it is protected and kept.
    assert.deepEqual(preview.tabs.map((t) => t.id), [4]);
    await apply.applySelection(settings({}, {}, {}, {}, { selection: 'duplicates' }));
    assert.deepEqual(chrome._highlights()[0].indices, [3]);
  });
});

test('selecting can skip pinned tabs', async () => {
  await withFakeChrome(SELECT_STRIP, async (apply) => {
    const all = await apply.previewSelection(settings({}, {}, {}, {}, { selection: 'all' }));
    assert.equal(all.count, 4);
    const unpinned = await apply.previewSelection(
      settings({}, {}, {}, {}, { selection: 'all', skipPinned: true })
    );
    assert.deepEqual(unpinned.tabs.map((t) => t.id), [2, 3, 4]);
  });
});

test('an empty selection explains itself and highlights nothing', async () => {
  await withFakeChrome(SELECT_STRIP, async (apply, chrome) => {
    const result = await apply.applySelection(
      settings({}, {}, {}, {}, { selection: 'filter', field: 'domain', mode: 'equals', value: 'nowhere.test' })
    );
    assert.equal(result.ok, false);
    assert.equal(result.selected, 0);
    assert.match(result.message, /No tabs match/);
    assert.deepEqual(chrome._highlights(), [], 'highlight() must not be called with an empty list');
  });
});

test('previewSelection changes nothing', async () => {
  await withFakeChrome(SELECT_STRIP, async (apply, chrome) => {
    await apply.previewSelection(settings({}, {}, {}, {}, { selection: 'all' }));
    assert.deepEqual(chrome._highlights(), []);
    assert.deepEqual(chrome._strip(), [1, 2, 3, 4]);
  });
});

test('closeDuplicates reports when there is nothing to do', async () => {
  await withFakeChrome(
    [
      { id: 1, url: 'https://a.com/', title: 'a', pinned: false, groupId: NONE },
      { id: 2, url: 'https://b.com/', title: 'b', pinned: false, groupId: NONE }
    ],
    async (apply) => {
      const result = await apply.closeDuplicates(settings());
      assert.equal(result.closed, 0);
      assert.match(result.message, /No duplicate/);
    }
  );
});
