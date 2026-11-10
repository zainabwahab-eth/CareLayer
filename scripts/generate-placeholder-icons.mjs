// Generates placeholder PWA icons (solid squares) for apps/web and apps/workers.
// No dependencies. Replace the output with real artwork when the brand is ready.
// Usage: node scripts/generate-placeholder-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const APPS = {
  web: { bg: [124, 58, 237], fg: [255, 255, 255] },
  workers: { bg: [13, 148, 136], fg: [255, 255, 255] },
};
const SIZES = [
  { name: 'pwa-192x192.png', size: 192, inset: 0.3 },
  { name: 'pwa-512x512.png', size: 512, inset: 0.3 },
  // Maskable icons need the motif inside the central 80% safe zone.
  { name: 'maskable-512x512.png', size: 512, inset: 0.38 },
  { name: 'apple-touch-icon-180x180.png', size: 180, inset: 0.3 },
];

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** Solid background with a centred square motif. RGB, 8-bit, no alpha. */
function png(size, bg, fg, inset) {
  const lo = Math.round(size * inset);
  const hi = size - lo;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const c = x >= lo && x < hi && y >= lo && y < hi ? fg : bg;
      raw.set(c, row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [app, { bg, fg }] of Object.entries(APPS)) {
  for (const { name, size, inset } of SIZES) {
    const out = join(root, 'apps', app, 'public', 'icons', name);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, png(size, bg, fg, inset));
    console.log(`wrote ${out}`);
  }
}
