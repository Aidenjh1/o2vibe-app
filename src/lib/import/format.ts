/**
 * Import formats for bringing older nights into the app.
 *
 * 1. The O2 desktop app's SQLite database (tables `sessions` + `readings`), read in the browser with sql.js.
 * 2. A compact, versioned JSON export (`*.o2vibe.json`), described by `O2VibeExportFile` below.
 *
 * Everything is parsed on the phone; nothing is uploaded.
 */

export const EXPORT_FORMAT = 'o2vibe-export'
export const EXPORT_VERSION = 1

/** One night ready to be stored (times are Unix ms). */
export interface ImportNight {
  /** Device-style file name (`YYYYMMDDhhmmss` of the start), used for display and identity. */
  fileName: string
  start: number
  intervalSec: number
  spo2: (number | null)[]
  pulse: (number | null)[]
  motion?: number[]
  notes?: string
}

export interface ImportFailure {
  label: string
  error: string
}

export interface ParsedImport {
  kind: 'desktop-db' | 'o2vibe-json'
  nights: ImportNight[]
  failed: ImportFailure[]
}

/**
 * `.o2vibe.json` v1. `start` is local wall-clock time without a zone ("2025-03-20T23:30:15"),
 * the same convention the O2 device and its desktop app use. Samples are on a regular grid of `intervalSec`;
 * `null` marks a missing / invalid sample.
 */
export interface O2VibeExportFile {
  format: typeof EXPORT_FORMAT
  version: number
  exportedAt?: string
  source?: string
  nights: {
    fileName?: string
    start: string
    intervalSec: number
    spo2: (number | null)[]
    pulse: (number | null)[]
    motion?: number[]
    notes?: string
  }[]
}

export class ImportError extends Error {
  name = 'ImportError'
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Parse "YYYY-MM-DD[T ]hh:mm[:ss]" as local time. Strings with an explicit zone (Z / ±hh:mm) are honoured. */
export function parseLocalStamp(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s.trim())
  if (!m) return NaN
  if (m[7]) return Date.parse(s)
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)).getTime()
}

export function formatLocalStamp(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Device file names are the start time as YYYYMMDDhhmmss. */
export function fileNameFor(ms: number): string {
  return formatLocalStamp(ms).replace(/[-T:]/g, '')
}

/** "Night of" date (YYYY-MM-DD): recordings that start before noon belong to the previous evening. */
export function eveningDate(ms: number): string {
  const d = new Date(ms)
  if (d.getHours() < 12) d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function parseO2VibeJson(text: string): ParsedImport {
  let data: O2VibeExportFile
  try {
    data = JSON.parse(text)
  } catch {
    throw new ImportError('This file is not valid JSON.')
  }
  if (!data || data.format !== EXPORT_FORMAT || !Array.isArray(data.nights)) throw new ImportError('This JSON file is not an O2 Vibe export (.o2vibe.json).')
  if (typeof data.version !== 'number' || data.version > EXPORT_VERSION) throw new ImportError(`This export was made by a newer version of the app (format v${data.version}). Please update the app and try again.`)
  const nights: ImportNight[] = []
  const failed: ImportFailure[] = []
  data.nights.forEach((n, i) => {
    const label = n?.fileName || n?.start || `night ${i + 1}`
    const start = typeof n?.start === 'string' ? parseLocalStamp(n.start) : NaN
    if (!Number.isFinite(start)) return failed.push({ label, error: 'missing or invalid start time' })
    if (!(typeof n.intervalSec === 'number' && n.intervalSec > 0 && n.intervalSec <= 60)) return failed.push({ label, error: 'missing or invalid sample interval' })
    if (!Array.isArray(n.spo2) || !Array.isArray(n.pulse) || n.spo2.length === 0) return failed.push({ label, error: 'no samples' })
    const len = n.spo2.length
    nights.push({
      fileName: n.fileName || fileNameFor(start),
      start,
      intervalSec: n.intervalSec,
      spo2: n.spo2.map(num),
      pulse: Array.from({ length: len }, (_, k) => num(n.pulse[k])),
      motion: Array.isArray(n.motion) ? n.motion.map((x) => num(x) ?? 0) : undefined,
      notes: typeof n.notes === 'string' && n.notes.trim() ? n.notes.trim() : undefined,
    })
  })
  return { kind: 'o2vibe-json', nights, failed }
}

export function toO2VibeJson(nights: ImportNight[], source = 'O2 Vibe app'): string {
  const file: O2VibeExportFile = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    source,
    nights: nights.map((n) => ({
      fileName: n.fileName,
      start: formatLocalStamp(n.start),
      intervalSec: n.intervalSec,
      spo2: n.spo2,
      pulse: n.pulse,
      ...(n.motion?.length ? { motion: n.motion } : {}),
      ...(n.notes ? { notes: n.notes } : {}),
    })),
  }
  return JSON.stringify(file)
}
