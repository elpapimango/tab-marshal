/**
 * The namespace shim. Its whole job is to pick the right global and to keep
 * picking it — a captured reference would silently pin the first one it saw,
 * which is exactly what the other suites' fake globals would trip over.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { api, isFirefox, hasTabGroups } from '../src/lib/browser.js';

function withGlobals(globals, fn) {
  const had = { browser: globalThis.browser, chrome: globalThis.chrome };
  for (const [k, v] of Object.entries(globals)) {
    if (v === undefined) delete globalThis[k];
    else globalThis[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const k of ['browser', 'chrome']) {
      if (had[k] === undefined) delete globalThis[k];
      else globalThis[k] = had[k];
    }
  }
}

test('falls back to chrome.* where that is all there is', () => {
  withGlobals({ browser: undefined, chrome: { tabs: { marker: 'chrome' } } }, () => {
    assert.equal(api.tabs.marker, 'chrome');
  });
});

test('prefers browser.* when both exist, as on Firefox', () => {
  withGlobals(
    { browser: { tabs: { marker: 'browser' } }, chrome: { tabs: { marker: 'chrome' } } },
    () => {
      assert.equal(api.tabs.marker, 'browser');
    }
  );
});

test('resolves on every access, not once at import', () => {
  withGlobals({ browser: undefined, chrome: { tabs: { marker: 'first' } } }, () => {
    assert.equal(api.tabs.marker, 'first');
  });
  withGlobals({ browser: undefined, chrome: { tabs: { marker: 'second' } } }, () => {
    assert.equal(api.tabs.marker, 'second', 'the shim pinned the first namespace');
  });
});

test('methods keep their namespace as `this`', () => {
  const ns = {
    tabs: {
      name: 'real',
      who() {
        return this.name;
      }
    }
  };
  withGlobals({ browser: undefined, chrome: ns }, () => {
    assert.equal(api.tabs.who(), 'real');
  });
});

test('missing globals yield undefined rather than throwing', () => {
  withGlobals({ browser: undefined, chrome: undefined }, () => {
    assert.equal(api.tabs, undefined);
    assert.equal(isFirefox(), false);
    assert.equal(hasTabGroups(), false);
  });
});

test('Firefox is detected by an API only it implements', () => {
  withGlobals({ browser: { runtime: { getBrowserInfo() {} } }, chrome: undefined }, () => {
    assert.equal(isFirefox(), true);
  });
  // Chrome has runtime, but no getBrowserInfo.
  withGlobals({ browser: undefined, chrome: { runtime: { getURL() {} } } }, () => {
    assert.equal(isFirefox(), false);
  });
});

test('tabGroups support is detected, not assumed', () => {
  withGlobals({ browser: undefined, chrome: { tabGroups: {} } }, () => {
    assert.equal(hasTabGroups(), true);
  });
  withGlobals({ browser: undefined, chrome: { tabs: {} } }, () => {
    assert.equal(hasTabGroups(), false);
  });
});

test('`in` works through the shim', () => {
  withGlobals({ browser: undefined, chrome: { tabs: {} } }, () => {
    assert.equal('tabs' in api, true);
    assert.equal('tabGroups' in api, false);
  });
});
