/**
 * Stored O2 recording ("vld"/".dat") format.
 *
 * Header is 40 bytes, then 5-byte records. Layout from the vendor SDK (LepuBle OxyDataFile.kt),
 * cross-checked with o2r o2file.py (which reads it as '<HHBBBBBHHHHBBBBBHBB' and requires version 3):
 *
 *   [0]      version (3)          [1]      mode (0 sleep, 1 monitor)
 *   [2-3]    year u16             [4..8]   month, day, hour, minute, second (device local time)
 *   [9-12]   file size u32        [13-14]  record time (s) u16      [15-16] asleep time (reserved)
 *   [17]     avg SpO2             [18]     min SpO2                 [19] drops ≥3%   [20] drops ≥4%
 *   [21-22]  time <90% (s) u16    [23]     count <90%               [24] % <90       [25] O2 score ×10
 *   [26-29]  steps u32            [30-39]  reserved
 *
 * Record: [0] SpO2 (0xFF / out of range = invalid), [1-2] pulse u16 LE (0xFFFF = invalid),
 *         [3] motion (max 3-axis accel over the interval), [4] reserved / vibration flag.
 * Sample interval is not stored; it is record_time / record_count (2 s or 4 s on O2Ring, 1/4 s on newer).
 */

export const HEADER_SIZE = 40
export const RECORD_SIZE = 5

export interface O2FileHeader {
  version: number
  mode: number
  start: Date
  recordTimeSec: number
  avgSpo2: number
  minSpo2: number
  drops3: number
  drops4: number
  timeBelow90Sec: number
  countBelow90: number
  o2Score: number
  steps: number
}

export interface O2Recording {
  header: O2FileHeader
  intervalSec: number
  /** Unix ms per sample. */
  t: number[]
  /** SpO2 % or null if invalid. */
  spo2: (number | null)[]
  /** Pulse bpm or null if invalid. */
  pulse: (number | null)[]
  motion: number[]
}

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + b[i + 3] * 0x1000000

export function parseO2File(bytes: Uint8Array): O2Recording {
  if (bytes.length < HEADER_SIZE) throw new Error('Recording is too short to contain a header')
  const version = bytes[0]
  if (version !== 3) throw new Error(`Unsupported recording format version ${version}`)
  const year = u16(bytes, 2)
  const [month, day, hour, minute, second] = [bytes[4], bytes[5], bytes[6], bytes[7], bytes[8]]
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error('Recording has an invalid start date')
  }
  const start = new Date(year, month - 1, day, hour, minute, second)
  const header: O2FileHeader = {
    version,
    mode: bytes[1],
    start,
    recordTimeSec: u16(bytes, 13),
    avgSpo2: bytes[17],
    minSpo2: bytes[18],
    drops3: bytes[19],
    drops4: bytes[20],
    timeBelow90Sec: u16(bytes, 21),
    countBelow90: bytes[23],
    o2Score: bytes[25] / 10,
    steps: u32(bytes, 26),
  }
  const count = Math.floor((bytes.length - HEADER_SIZE) / RECORD_SIZE)
  if (count < 1) throw new Error('Recording contains no samples')
  const intervalSec = inferInterval(header.recordTimeSec, count)
  const t: number[] = []
  const spo2: (number | null)[] = []
  const pulse: (number | null)[] = []
  const motion: number[] = []
  const t0 = start.getTime()
  for (let i = 0; i < count; i++) {
    const o = HEADER_SIZE + i * RECORD_SIZE
    const s = bytes[o]
    const p = u16(bytes, o + 1)
    t.push(t0 + i * intervalSec * 1000)
    spo2.push(s >= 35 && s <= 100 ? s : null)
    pulse.push(p >= 25 && p <= 250 ? p : null)
    motion.push(bytes[o + 3])
  }
  return { header, intervalSec, t, spo2, pulse, motion }
}

/** Snap record_time / count to a known device interval; default 4 s. */
export function inferInterval(recordTimeSec: number, count: number): number {
  if (!recordTimeSec || !count) return 4
  const r = recordTimeSec / count
  const known = [1, 2, 4]
  let best = 4
  let err = Infinity
  for (const k of known) {
    const e = Math.abs(r - k) / k
    if (e < err) {
      err = e
      best = k
    }
  }
  return err < 0.25 ? best : 4
}

/** Encode a recording in the same format (used by demo mode's simulated device and by tests). */
export function encodeO2File(opts: {
  start: Date
  intervalSec: number
  spo2: (number | null)[]
  pulse: (number | null)[]
  motion?: number[]
  mode?: number
}): Uint8Array {
  const n = opts.spo2.length
  const out = new Uint8Array(HEADER_SIZE + n * RECORD_SIZE)
  const d = opts.start
  const valid = opts.spo2.filter((v): v is number => v != null)
  const below = valid.filter((v) => v < 90).length
  out[0] = 3
  out[1] = opts.mode ?? 0
  out[2] = d.getFullYear() & 0xff
  out[3] = d.getFullYear() >> 8
  out.set([d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()], 4)
  const size = out.length
  out.set([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff], 9)
  const rt = Math.min(0xffff, n * opts.intervalSec)
  out.set([rt & 0xff, rt >> 8], 13)
  out[17] = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : 0
  out[18] = valid.length ? Math.min(...valid) : 0
  const t90 = Math.min(0xffff, below * opts.intervalSec)
  out.set([t90 & 0xff, t90 >> 8], 21)
  for (let i = 0; i < n; i++) {
    const o = HEADER_SIZE + i * RECORD_SIZE
    const s = opts.spo2[i]
    const p = opts.pulse[i]
    out[o] = s == null ? 0xff : s
    const pv = p == null ? 0xffff : p
    out[o + 1] = pv & 0xff
    out[o + 2] = pv >> 8
    out[o + 3] = opts.motion?.[i] ?? 0
    out[o + 4] = 0
  }
  return out
}
