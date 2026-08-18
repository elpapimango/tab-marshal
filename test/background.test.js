/**
 * Exercises the service worker itself, which had no coverage — which is how the
 * two bugs here (a pending set that raced itself, and menu rebuilds that could
 * overlap) went unnoticed.
 *
 * background.js registers all its listeners at import time, so the fake collects
 * them and the tests fire them by hand.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

function makeFakeChrome() {
  const listeners = new Map();
  const on = (name) => ({
    addListener: (fn) => {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    }
  });

  const session = {};
  const sync = {};
  const menuIds = new Set();
  const created = [];
  const badges = [];
  let lastError;

  const chrome = {
    _fire: (name, ...args) => (listeners.get(name) || []).map((fn) => fn(...args)),
    _listenerCount: (name) => (listeners.get(name) || []).length,
    _session: () => ({ ...session }),
    _menuIds: () => [...menuIds],
    _created: () => created.map((c) => ({ ...c })),
    _badges: () => [...badges],
    runtime: {
      id: 'tab-marshal@test',
      get lastError() {
        return lastError;
      },
      onInstalled: on('installed'),
      onStartup: on('startup'),
      onMessage: on('message')
    },
    commands: { onCommand: on('command') },
    contextMenus: {
      onClicked: on('menuClicked'),
      removeAll: (callback) => {
        menuIds.clear();
        // Chromium's callback style. Deliberately deferred: the interleaving this
        // suite is about only exists because the callback lands later.
        Promise.resolve().then(() => callback && callback());
      },
      create: (props, callback) => {
        // The browser refuses an id that already exists, and reports it through
        // lastError rather than by throwing.
        lastError = menuIds.has(props.id) ? { message: `duplicate id ${props.id}` } : undefined;
        if (!lastError) menuIds.add(props.id);
        created.push({ id: props.id, failed: Boolean(lastError) });
        if (callback) callback();
        lastError = undefined;
      }
    },
    action: {
      setBadgeText: async ({ text }) => badges.push(text),
      setBadgeBackgroundColor: async () => {}
    },
    tabs: {
      onCreated: on('tabCreated'),
      onUpdated: on('tabUpdated'),
      onRemoved: on('tabRemoved'),
      get: async (id) => ({ id, url: 'https://example.com/', windowId: 1 }),
      query: async () => [],
      remove: async () => {},
      reload: async () => {},
      update: async () => ({})
    },
    windows: {
      get: async (id) => ({ id, type: 'normal' }),
      getCurrent: async () => ({ id: 1 }),
      getAll: async () => [{ id: 1 }],
      update: async () => {}
    },
    // Reads and writes clone, exactly as the real thing does — handing out the
    // stored object itself would let two racing readers quietly share one map and
    // hide the very races these tests are for.
    storage: {
      onChanged: on('storageChanged'),
      sync: {
        get: async (key) => (sync[key] === undefined ? {} : { [key]: structuredClone(sync[key]) }),
        set: async (obj) => Object.assign(sync, structuredClone(obj))
      },
      session: {
        get: async (key) => (session[key] === undefined ? {} : { [key]: structuredClone(session[key]) }),
        set: async (obj) => Object.assign(session, structuredClone(obj))
      }
    }
  };
  return chrome;
}

/** Fresh fake plus a fresh module instance, since listeners register on import. */
async function withWorker(fn) {
  const chrome = makeFakeChrome();
  globalThis.chrome = chrome;
  try {
    await import(`../src/background.js?t=${Math.random()}`);
    return await fn(chrome);
  } finally {
    delete globalThis.chrome;
  }
}

/** Let every queued promise settle — the fake resolves storage on microtasks. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('two tabs opening at once both end up in the pending set', async () => {
  await withWorker(async (chrome) => {
    // Fired without awaiting in between, which is the read-modify-write window:
    // both used to read the same map, and the second write erased the first,
    // leaving a tab that is never recognised as new.
    const first = chrome._fire('tabCreated', { id: 11, windowId: 1 });
    const second = chrome._fire('tabCreated', { id: 12, windowId: 1 });
    await Promise.all([...first, ...second]);
    await settle();

    const pending = chrome._session().watchPendingTabs || {};
    assert.deepEqual(Object.keys(pending).sort(), ['11', '12']);
  });
});

test('two tabs navigating at once are both claimed', async () => {
  await withWorker(async (chrome) => {
    await Promise.all(chrome._fire('tabCreated', { id: 21, windowId: 1 }));
    await Promise.all(chrome._fire('tabCreated', { id: 22, windowId: 1 }));
    await settle();
    assert.deepEqual(Object.keys(chrome._session().watchPendingTabs).sort(), ['21', '22']);

    // Same window the other way round: two claims racing would each write back a
    // map still holding the other's tab, resurrecting one of them.
    const a = chrome._fire('tabUpdated', 21, { url: 'https://a.test/' }, { id: 21, url: 'https://a.test/', windowId: 1 });
    const b = chrome._fire('tabUpdated', 22, { url: 'https://b.test/' }, { id: 22, url: 'https://b.test/', windowId: 1 });
    await Promise.all([...a, ...b]);
    await settle();

    assert.deepEqual(Object.keys(chrome._session().watchPendingTabs), []);
  });
});

test('overlapping menu rebuilds never create an id twice', async () => {
  await withWorker(async (chrome) => {
    // Install and startup both ask for a rebuild, and the colour-scheme and
    // icon-preference listeners can pile on. Interleaved, the second batch used
    // to land on ids the first had already created.
    chrome._fire('installed');
    chrome._fire('startup');
    chrome._fire('storageChanged', { tabSorterSettings: { oldValue: { menuIcons: true }, newValue: { menuIcons: false } } }, 'sync');
    await settle();
    await settle();

    const duplicates = chrome._created().filter((c) => c.failed);
    assert.deepEqual(duplicates, [], 'no menu item should be created twice');
    assert.ok(chrome._menuIds().includes('tab-marshal-root'));
    assert.ok(chrome._menuIds().includes('sort-saved'));
  });
});

test('a rebuild leaves exactly one of each item behind', async () => {
  await withWorker(async (chrome) => {
    chrome._fire('startup');
    await settle();
    const first = chrome._menuIds().length;
    assert.ok(first > 1);

    chrome._fire('startup');
    await settle();
    assert.equal(chrome._menuIds().length, first);
  });
});

test('a reload message from another extension is refused', async () => {
  await withWorker(async (chrome) => {
    const [handled] = chrome._fire(
      'message',
      { type: 'reload', settings: { scope: 'window', reload: { selection: 'all' } } },
      { id: 'someone-else' },
      () => assert.fail('a foreign sender must not get a response')
    );
    assert.equal(handled, false);
  });
});

test('a reload message from our own popup is answered', async () => {
  await withWorker(async (chrome) => {
    let response;
    const [handled] = chrome._fire(
      'message',
      { type: 'reload', settings: { scope: 'window', reload: { selection: 'all', delayMs: 0 } } },
      { id: chrome.runtime.id },
      (r) => {
        response = r;
      }
    );
    // `true` keeps the channel open for the async answer.
    assert.equal(handled, true);
    await settle();
    assert.ok(response, 'the popup should get a result back');
  });
});

test('anything other than a reload is passed over', async () => {
  await withWorker(async (chrome) => {
    const [handled] = chrome._fire('message', { type: 'something-else' }, { id: chrome.runtime.id }, () => {});
    assert.equal(handled, false);
  });
});
