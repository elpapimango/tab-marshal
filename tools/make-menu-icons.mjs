/**
 * Generates the context-menu glyphs.
 *
 *   node tools/make-menu-icons.mjs
 *
 * Two variants per glyph, written from one set of paths so the pair can never
 * drift. The suffix names the colour scheme the file is *used in*, not the
 * colour of the ink: `-light.svg` is the dark glyph shown on a light menu.
 *
 * Firefox is the only browser that renders custom menu icons, and it does so
 * only for submenu items.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'icons', 'menu');

/** Firefox's own menu text colours, so the glyphs sit at the same weight. */
const INK = { light: '#1c1b22', dark: '#fbfbfe' };

const GLYPHS = {
  // Three bars, shortening — the same idea as the toolbar icon.
  sort: '<path d="M3 4h10"/><path d="M3 8h6.5"/><path d="M3 12h3.5"/>',
  // A marquee with a tick inside: picked out, not acted on.
  select:
    '<rect x="2.4" y="2.4" width="11.2" height="11.2" rx="2.2" stroke-dasharray="2.6 2"/>' +
    '<path d="M5.6 8.1l1.9 1.9 3.4-3.9"/>',
  // A group's colour bar over two tabs sitting side by side — the tab-group pill.
  group:
    '<path d="M2.8 3.4h10.4" stroke-linecap="round"/>' +
    '<rect x="2.8" y="6.2" width="4.4" height="6.4" rx="1"/>' +
    '<rect x="8.8" y="6.2" width="4.4" height="6.4" rx="1"/>',
  // The usual two-sheets copy mark.
  duplicates: '<rect x="2.4" y="2.4" width="8" height="8" rx="1.6"/><path d="M5.6 13.6h5.9a2.1 2.1 0 0 0 2.1-2.1V5.6"/>',
  // Circular arrow.
  reload: '<path d="M13.2 8a5.2 5.2 0 1 1-1.7-3.85"/><path d="M13.3 2.6v3h-3"/>',
  // Arrow curving back on itself.
  undo: '<path d="M3.6 7.4h6.6a3.4 3.4 0 0 1 0 6.8H7.4"/><path d="M6.2 4.4L3.2 7.4l3 3"/>'
};

function svg(paths, ink) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" ` +
    `stroke="${ink}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>\n`
  );
}

mkdirSync(OUT_DIR, { recursive: true });
let count = 0;
for (const [name, paths] of Object.entries(GLYPHS)) {
  for (const [scheme, ink] of Object.entries(INK)) {
    const file = join(OUT_DIR, `${name}-${scheme}.svg`);
    writeFileSync(file, svg(paths, ink));
    console.log('wrote ' + relative(ROOT, file).split('\\').join('/'));
    count++;
  }
}
console.log(`${count} files, ${Object.keys(GLYPHS).length} glyphs x 2 schemes`);
