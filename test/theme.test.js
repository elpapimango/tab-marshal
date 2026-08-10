import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { THEMES, CONCRETE_THEMES, DEFAULT_THEME, resolveTheme } from '../src/lib/theme.js';

const CSS = readFileSync(fileURLToPath(new URL('../src/popup.css', import.meta.url)), 'utf8');

/** The variables every palette has to define for the UI to render. */
const REQUIRED_VARS = [
  '--bg',
  '--fg',
  '--muted',
  '--line',
  '--field',
  '--accent',
  '--accent-fg',
  '--danger',
  '--hover'
];

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

test('Nord and Dracula are explicit palettes, not browser-dependent', () => {
  for (const id of ['nord', 'dracula']) {
    assert.equal(resolveTheme(id, true), id);
    assert.equal(resolveTheme(id, false), id);
  }
});

test('popup.css defines a complete block for every concrete theme', () => {
  for (const id of CONCRETE_THEMES) {
    const block = themeBlock(id);
    assert.ok(block, `popup.css has no [data-theme='${id}'] block`);
    for (const name of REQUIRED_VARS) {
      assert.match(block, new RegExp(`${name}:`), `${id} does not set ${name}`);
    }
    assert.match(block, /color-scheme:\s*(light|dark)/, `${id} does not set color-scheme`);
  }
});

test('no palette maps a variable to an undefined custom property', () => {
  const defined = new Set([...CSS.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]));
  const referenced = [...CSS.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]);
  for (const name of referenced) {
    assert.ok(defined.has(name), `${name} is used but never defined`);
  }
});

function themeBlock(id) {
  const start = CSS.indexOf(`:root[data-theme='${id}']`);
  if (start === -1) return null;
  const open = CSS.indexOf('{', start);
  const close = CSS.indexOf('}', open);
  return CSS.slice(open, close);
}

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
