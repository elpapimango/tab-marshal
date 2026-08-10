/**
 * Generates the extension icons as PNGs so the repo needs no binary assets
 * checked in by hand and no image tooling installed.
 *
 *   node tools/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const SIZES = [16, 32, 48, 128];

const BG = [15, 108, 189, 255]; // Edge-ish blue
const FG = [255, 255, 255, 255];

/** Three left-aligned bars of decreasing width — the usual "sort" glyph. */
function drawIcon(size) {
  const px = (x, y) => ((y * size + x) << 2);
  const data = new Uint8Array(size * size * 4);
  const radius = Math.round(size * 0.22);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = px(x, y);
      const inside = insideRoundedRect(x, y, size, radius);
      const c = inside ? BG : [0, 0, 0, 0];
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = c[3];
    }
  }

  const barH = Math.max(1, Math.round(size * 0.11));
  const gap = Math.max(1, Math.round(size * 0.1));
  const left = Math.round(size * 0.22);
  const widths = [0.56, 0.4, 0.24].map((w) => Math.round(size * w));
  const totalH = barH * 3 + gap * 2;
  let top = Math.round((size - totalH) / 2);

  for (const w of widths) {
    for (let y = top; y < top + barH; y++) {
      for (let x = left; x < left + w; x++) {
        if (x >= size || y >= size) continue;
        const i = px(x, y);
        data[i] = FG[0];
        data[i + 1] = FG[1];
        data[i + 2] = FG[2];
        data[i + 3] = FG[3];
      }
    }
    top += barH + gap;
  }
  return data;
}

function insideRoundedRect(x, y, size, r) {
  const inX = x >= r && x < size - r;
  const inY = y >= r && y < size - r;
  if (inX || inY) return true;
  const cx = x < r ? r : size - r - 1;
  const cy = y < r ? r : size - r - 1;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = buildCrcTable());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    crc = (crc >>> 8) ^ table[c];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function toPng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 stay 0: deflate / adaptive filtering / no interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, toPng(drawIcon(size), size));
  console.log(`wrote ${file}`);
}
