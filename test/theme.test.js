import { test } from 'node:test';
import assert from 'node:assert/strict';

import { THEMES, CONCRETE_THEMES, DEFAULT_THEME, resolveTheme } from '../src/lib/theme.js';

test('explicit themes resolve to themselves regardless of the browser', () => {
  for (const id of CONCRETE_THEMES) {
    assert.equal(resolveTheme(id, true), id);
    assert.equal(resolveTheme(id, false), id);
  }
});

test('"match browser" follows the reported colour scheme', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
});

test('Catppuccin auto picks Mocha for dark and Latte for light', () => {
  assert.equal(resolveTheme('ctp-auto', true), 'ctp-mocha');
  assert.equal(resolveTheme('ctp-auto', false), 'ctp-latte');
});

test('an unknown or missing choice falls back to following the browser', () => {
  assert.equal(resolveTheme('solarized', true), 'dark');
  assert.equal(resolveTheme(undefined, false), 'light');
  assert.equal(resolveTheme('', true), 'dark');
});

test('every offered theme resolves to a palette the stylesheet implements', () => {
  for (const theme of THEMES) {
    for (const dark of [true, false]) {
      assert.ok(
        CONCRETE_THEMES.includes(resolveTheme(theme.id, dark)),
        `${theme.id} (dark=${dark}) resolved outside CONCRETE_THEMES`
      );
    }
  }
  assert.ok(THEMES.some((t) => t.id === DEFAULT_THEME));
});
