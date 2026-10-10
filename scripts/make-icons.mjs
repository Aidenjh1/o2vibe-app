// Generates the PWA PNG icons with no dependencies (pure JS rasteriser + zlib PNG encoder).
// Runs automatically before `npm run build` so binary files don't need to live in git.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const OUT = new URL('../public/', import.meta.url).pathname
mkdirSync(OUT + 'icons', { recursive: true })

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function png(size, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

// Geometry in a 512 design space (matches public/icons/icon.svg).
const DROP = { cx: 256, cy: 308, r: 118, tipY: 92 }
const LINE = [[168, 318], [212, 318], [232, 274], [266, 366], [288, 318], [344, 318]]
const LINE_W = 22
function inRoundRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), 512 - r)
  const cy = Math.min(Math.max(y, r), 512 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}
function inDrop(x, y) {
  const { cx, cy, r, tipY } = DROP
  if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) return true
  const d = cy - tipY
  const th = Math.acos(r / d)
  // Tangent points from the tip to the circle.
  const tx = r * Math.sin(th)
  const ty = cy - r * Math.cos(th)
  if (y < tipY || y > ty) return false
  const half = ((y - tipY) / (ty - tipY)) * tx
  return Math.abs(x - cx) <= half
}
function distSeg(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}
function onLine(x, y) {
  for (let i = 0; i < LINE.length - 1; i++) if (distSeg(x, y, LINE[i], LINE[i + 1]) <= LINE_W / 2) return true
  return false
}

function render(size, { pad = 0, rounded = true } = {}) {
  const ss = 4
  const buf = Buffer.alloc(size * size * 4)
  const a = [0x14, 0xb8, 0xa6]
  const b = [0x25, 0x63, 0xeb]
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let R = 0, G = 0, B = 0, A = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const ux = ((px + (sx + 0.5) / ss) / size) * 512
          const uy = ((py + (sy + 0.5) / ss) / size) * 512
          if (rounded && !inRoundRect(ux, uy, 112)) continue
          const t = (ux + uy) / 1024
          let c = [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t)
          const k = 1 - 2 * pad
          const gx = (ux - 512 * pad) / k
          const gy = (uy - 512 * pad) / k
          if (onLine(gx, gy)) c = [14, 116, 144]
          else if (inDrop(gx, gy)) c = [255, 255, 255]
          R += c[0]; G += c[1]; B += c[2]; A += 255
        }
      }
      const n = ss * ss
      const o = (py * size + px) * 4
      const cov = A / 255
      buf[o] = cov ? R / cov : 0
      buf[o + 1] = cov ? G / cov : 0
      buf[o + 2] = cov ? B / cov : 0
      buf[o + 3] = A / n
    }
  }
  return png(size, buf)
}

writeFileSync(OUT + 'icons/icon-192.png', render(192))
writeFileSync(OUT + 'icons/icon-512.png', render(512))
writeFileSync(OUT + 'icons/maskable-512.png', render(512, { pad: 0.12, rounded: false }))
writeFileSync(OUT + 'icons/apple-touch-icon.png', render(180, { rounded: false }))
writeFileSync(OUT + 'favicon.png', render(64))
console.log('icons written')
