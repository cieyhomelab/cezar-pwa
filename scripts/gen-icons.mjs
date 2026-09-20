#!/usr/bin/env node
/**
 * Generates the PWA icon set as PNGs with no image dependency: zlib is enough to
 * write a valid PNG by hand.
 *
 * The mark is a ring with a wedge cut out of its right side — a "C" for Cezar —
 * drawn with 3x3 supersampling. It is a deliberate placeholder: geometry, not
 * branding. Replace the palette/mark here when the cockpit's real icon exists;
 * `npm run gen:icons` rewrites every size.
 *
 * Maskable variants keep the mark inside the inner 80% safe zone required by
 * https://w3c.github.io/manifest/#icon-masks so Android can crop them to any shape.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BG = [0x0b, 0x11, 0x17] // dark theme background
const FG = [0xe6, 0xed, 0xf3] // light foreground

const crcTable = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  // 10..12 = compression, filter, interlace — all 0
  const raw = Buffer.alloc(size * (size * 3 + 1))
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0 // filter type: none
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3
      raw[o++] = pixels[i]
      raw[o++] = pixels[i + 1]
      raw[o++] = pixels[i + 2]
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Coverage of the "C" mark at one point, 0..1, via 3x3 supersampling. */
function coverage(x, y, size, scale) {
  const c = size / 2
  const rOuter = size * 0.38 * scale
  const rInner = size * 0.25 * scale
  const gap = 0.7 // half-angle of the wedge, radians
  let hits = 0
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const px = x + (sx + 0.5) / 3 - c
      const py = y + (sy + 0.5) / 3 - c
      const r = Math.hypot(px, py)
      if (r < rInner || r > rOuter) continue
      if (Math.abs(Math.atan2(py, px)) < gap) continue // the opening of the C
      hits++
    }
  }
  return hits / 9
}

function render(size, { maskable = false } = {}) {
  // A maskable icon may be cropped to a circle inscribed in the inner 80%,
  // so the mark has to shrink to stay inside it.
  const scale = maskable ? 0.8 : 1
  const pixels = Buffer.alloc(size * size * 3)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = coverage(x, y, size, scale)
      const i = (y * size + x) * 3
      for (let ch = 0; ch < 3; ch++) {
        pixels[i + ch] = Math.round(BG[ch] * (1 - a) + FG[ch] * a)
      }
    }
  }
  return png(size, pixels)
}

const outDir = join(import.meta.dirname, '..', 'apps', 'pwa', 'public', 'icons')
const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  // iOS ignores the manifest and reads apple-touch-icon; it also composites on
  // an opaque background, which is why these icons are not transparent.
  ['apple-touch-icon-180.png', 180, {}],
]
for (const [name, size, opts] of targets) {
  writeFileSync(join(outDir, name), render(size, opts))
  console.log(`wrote icons/${name} (${size}x${size})`)
}
