/**
 * Settings round-trip. The interesting failure mode is storing something
 * chrome.storage cannot structured-clone (a compiled RegExp), which throws at
 * runtime and loses every setting in the same write.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

async function withFakeStorage(initial, fn) {
  let store = initial ? { tabSorterSettings: initial } : {};
  globalThis.chrome = {
    storage: {
      sync: {
        get: async (key) => (store[key] === undefined ? {} : { [key]: store[key] }),
        set: async (obj) => {
          // chrome.storage rejects anything not structured-cloneable.
          structuredClone(obj);
          Object.assign(store, obj);
        }
      }
    }
  };
  const settings = await import(`../src/lib/settings.js?t=${Math.random()}`);
  try {
    return await fn(settings, () => store.tabSorterSettings);
  } finally {
    delete globalThis.chrome;
  }
}

test('defaults are returned when nothing is stored', async () => {
  await withFakeStorage(null, async ({ loadSettings }) => {
    const settings = await loadSettings();
    assert.equal(settings.scope, 'window');
    assert.equal(settings.theme, 'system');
    assert.equal(settings.sort.primary, 'domain');
    assert.equal(settings.duplicates.matchMode, 'ignore-hash');
    assert.equal(settings.reload.selection, 'all');
  });
});

test('stored values win, and new keys still get their defaults', async () => {
  await withFakeStorage({ theme: 'ctp-mocha', sort: { primary: 'title' } }, async ({ loadSettings }) => {
    const settings = await loadSettings();
    assert.equal(settings.theme, 'ctp-mocha');
    assert.equal(settings.sort.primary, 'title');
    // Absent from the stored blob — an upgrade must not leave it undefined.
    assert.equal(settings.sort.groupPlacement, 'interleave');
    assert.equal(settings.reload.delayMs, 100);
  });
});

test('compiled regexes are stripped before saving', async () => {
  await withFakeStorage(null, async ({ loadSettings, saveSettings }, stored) => {
    const settings = await loadSettings();
    settings.sort.compiledRegex = /abc/u;
    settings.sort.__prepared = true;
    settings.reload.compiledFilter = /def/i;
    settings.reload.__prepared = true;

    await saveSettings(settings); // structuredClone would throw on a RegExp

    assert.equal(stored().sort.compiledRegex, undefined);
    assert.equal(stored().sort.__prepared, undefined);
    assert.equal(stored().reload.compiledFilter, undefined);
    assert.equal(stored().reload.__prepared, undefined);
  });
});

test('a save/load round trip preserves every section', async () => {
  await withFakeStorage(null, async ({ loadSettings, saveSettings }) => {
    const settings = await loadSettings();
    settings.scope = 'all';
    settings.theme = 'ctp-frappe';
    settings.sort.primary = 'regex';
    settings.sort.regexPattern = '/issue/([A-Z]+)';
    settings.duplicates.keep = 'mru';
    settings.reload.selection = 'filter';
    settings.reload.value = 'github.com';
    await saveSettings(settings);

    const reloaded = await loadSettings();
    assert.equal(reloaded.scope, 'all');
    assert.equal(reloaded.theme, 'ctp-frappe');
    assert.equal(reloaded.sort.regexPattern, '/issue/([A-Z]+)');
    assert.equal(reloaded.duplicates.keep, 'mru');
    assert.equal(reloaded.reload.value, 'github.com');
  });
});
