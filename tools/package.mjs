/**
 * Builds the distributable zip.
 *
 *   node tools/package.mjs
 *
 * Writes dist/tab-sorter-<version>.zip containing only what the extension
 * needs, with manifest.json at the root — addons.mozilla.org and the Chrome
 * Web Store both reject a zip that nests everything inside a folder.
 *
 * Written by hand rather than shelling out to a zip tool so the build works the
 * same on any platform and still needs no dependencies. Entries are added in a
 * fixed order with a fixed timestamp, so the same source always produces a
 * byte-identical archive.
 */
import { deflateRawSync } from 'node:zlib';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'dist');

/** Everything the extension loads at runtime, plus the licence. */
const INCLUDE = ['manifest.json', 'LICENSE', 'icons', 'src'];

/** Fixed timestamp keeps the archive reproducible. */
const DOS_TIME = { date: ((2020 - 1980) << 9) | (1 << 5) | 1, time: 0 };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function collect(entry) {
  const abs = join(ROOT, entry);
  const stat = statSync(abs);
  if (stat.isFile()) return [entry];
  return readdirSync(abs)
    .sort()
    .flatMap((child) => collect(join(entry, child)));
}

function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    // Zip entries always use forward slashes, whatever the host platform uses.
    const name = Buffer.from(file.split(sep).join('/'), 'utf8');
    const raw = readFileSync(join(ROOT, file));
    const deflated = deflateRawSync(raw, { level: 9 });
    // Storing beats deflating when the file is small or already compressed.
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME.time, 10);
    local.writeUInt16LE(DOS_TIME.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME.time, 12);
    central.writeUInt16LE(DOS_TIME.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, end]);
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const files = INCLUDE.flatMap(collect);
const zip = buildZip(files);

mkdirSync(OUT_DIR, { recursive: true });
const out = join(OUT_DIR, `tab-sorter-${manifest.version}.zip`);
writeFileSync(out, zip);

console.log(`${relative(ROOT, out)}  (${files.length} files, ${(zip.length / 1024).toFixed(1)} kB)`);
for (const f of files) console.log('  ' + f.split(sep).join('/'));
