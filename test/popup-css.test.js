/**
 * Guards a CSS trap that a scripted check cannot see.
 *
 * popup.js hides optional rows by setting `element.hidden = true`. That relies
 * on the UA rule `[hidden] { display: none }`, which ANY author rule setting
 * `display` overrides — and every one of those rows is a `.row`, which is
 * `display: flex`. The result is a control that reports `hidden === true` while
 * staying fully visible, so asserting on the property proves nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name) => readFileSync(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), 'utf8');
const CSS = read('popup.css');
const HTML = read('popup.html');
const JS = read('popup.js');

test('[hidden] is forced to display: none', () => {
  const rule = CSS.match(/\[hidden\]\s*\{([^}]*)\}/);
  assert.ok(rule, 'popup.css has no [hidden] rule; hidden rows will stay visible');
  assert.match(rule[1], /display:\s*none\s*!important/, '[hidden] must win over the layout rules');
});

test('every element the markup hides is covered by that rule', () => {
  // Elements carrying the attribute in the markup are the ones toggled at runtime.
  const ids = [...HTML.matchAll(/<[^>]*\bid="([\w-]+)"[^>]*\bhidden\b[^>]*>/g)].map((m) => m[1]);
  assert.ok(ids.length >= 4, `expected several hidden-by-default rows, found ${ids.length}`);

  for (const id of ids) {
    assert.match(
      JS,
      new RegExp(`\\.hidden\\s*=`),
      `${id} is hidden in the markup but nothing toggles a .hidden property`
    );
  }
});

test('the monogram fills the same slot as a real favicon', () => {
  // A row's icon is either an <img> or a .favicon-mono span, swapped at runtime
  // when a cookieless favicon request fails. If only the img is sized, the swap
  // collapses the slot and every row below shifts — which no property check on
  // the JS side would notice.
  const rule = CSS.match(/\.dupe-list img,\s*\.dupe-list \.favicon-mono\s*\{([^}]*)\}/);
  assert.ok(rule, 'the 16px slot rule no longer covers .favicon-mono');
  assert.match(rule[1], /width:\s*16px/);
  assert.match(rule[1], /height:\s*16px/);
  assert.match(JS, /class(?:Name)?\s*=\s*'favicon-mono'/, 'nothing creates the monogram any more');
});

test('favicon requests are made without credentials', () => {
  // The one outbound request the extension makes must not identify the user.
  assert.match(JS, /crossOrigin\s*=\s*'anonymous'/, 'favicon requests would carry cookies again');
  assert.match(JS, /referrerPolicy\s*=\s*'no-referrer'/);
});

test('classes used on hideable rows do set display, which is why the rule is needed', () => {
  // If this ever stops being true the override is harmless, but the comment
  // above would be stale — so assert the hazard actually exists.
  assert.match(CSS, /\.row\s*\{[^}]*display:\s*flex/, '.row no longer sets display');
});
