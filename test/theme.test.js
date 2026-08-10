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

test('each scheme has an auto variant pairing its light and dark flavours', () => {
  const pairs = {
    'ctp-auto': ['ctp-latte', 'ctp-mocha'],
    'nord-auto': ['nord-light', 'nord'],
    'dracula-auto': ['alucard', 'dracula'],
    system: ['light', 'dark']
  };
  for (const [choice, [light, dark]] of Object.entries(pairs)) {
    assert.equal(resolveTheme(choice, false), light, `${choice} light`);
    assert.equal(resolveTheme(choice, true), dark, `${choice} dark`);
  }
});

test('every group offering an auto variant also offers both flavours', () => {
  const byGroup = new Map();
  for (const t of THEMES) {
    if (!byGroup.has(t.group)) byGroup.set(t.group, []);
    byGroup.get(t.group).push(t.id);
  }
  for (const [group, ids] of byGroup) {
    const auto = ids.find((id) => !CONCRETE_THEMES.includes(id));
    if (!auto) continue;
    const light = resolveTheme(auto, false);
    const dark = resolveTheme(auto, true);
    assert.ok(ids.includes(light), `${group}: ${light} is not offered on its own`);
    assert.ok(ids.includes(dark), `${group}: ${dark} is not offered on its own`);
    assert.notEqual(light, dark, `${group}: the auto variant resolves the same either way`);
  }
});

test('an unknown or missing choice falls back to following the browser', () => {
  assert.equal(resolveTheme('solarized', true), 'dark');
  assert.equal(resolveTheme(undefined, false), 'light');
  assert.equal(resolveTheme('', true), 'dark');
});

test('naming a flavour outright pins it, whatever the browser prefers', () => {
  for (const id of ['nord', 'nord-light', 'dracula', 'alucard']) {
    assert.equal(resolveTheme(id, true), id);
    assert.equal(resolveTheme(id, false), id);
  }
});

test('light palettes declare a light colour-scheme and dark ones dark', () => {
  const expected = {
    light: 'light',
    'ctp-latte': 'light',
    'nord-light': 'light',
    alucard: 'light',
    dark: 'dark',
    'ctp-frappe': 'dark',
    'ctp-macchiato': 'dark',
    'ctp-mocha': 'dark',
    nord: 'dark',
    dracula: 'dark'
  };
  for (const id of CONCRETE_THEMES) {
    assert.ok(expected[id], `${id} is not covered by this test — add it`);
    assert.match(
      themeBlock(id),
      new RegExp(`color-scheme:\\s*${expected[id]}\\b`),
      `${id} should declare color-scheme: ${expected[id]}`
    );
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
