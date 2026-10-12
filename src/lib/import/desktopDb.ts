import type { Database, SqlJsStatic } from 'sql.js'
import { eveningDate, fileNameFor, ImportError, parseLocalStamp, type ImportFailure, type ImportNight, type ParsedImport } from './format'

/** First 16 bytes of every SQLite 3 file. */
export function isSqlite(bytes: Uint8Array): boolean {
  const sig = 'SQLite format 3\0'
  if (bytes.length < 16) return false
  for (let i = 0; i < 16; i++) if (bytes[i] !== sig.charCodeAt(i)) return false
  return true
}

/** Longest night we will rebuild onto a regular grid (guards against corrupt timestamps). */
const MAX_NIGHT_SEC = 36 * 3600

const columns = (db: Database, table: string): string[] => {
  const r = db.exec(`PRAGMA table_info("${table}")`)
  return r.length ? r[0].values.map((v) => String(v[1]).toLowerCase()) : []
}

/**
 * Read the O2 desktop app database:
 *   sessions(id, start_time, end_time, label "Downloaded: YYYYMMDDhhmmss", notes)
 *   readings(session_id, timestamp, spo2, hr, pi, battery)   — one row per sample, local-time ISO stamps
 *   daily_notes(date, notes)                                  — optional, keyed by the night's evening date
 * Samples are placed on a regular grid (the device's 2 s / 4 s interval); missing rows become null gaps, so
 * dropped / invalid stretches show up as "no signal" rather than being stitched together.
 */
export function readDesktopDb(SQL: SqlJsStatic, bytes: Uint8Array, onProgress?: (done: number, total: number) => void): ParsedImport {
  let db: Database
  try {
    db = new SQL.Database(bytes)
  } catch {
    throw new ImportError('This file could not be opened as a database.')
  }
  try {
    const sCols = columns(db, 'sessions')
    const rCols = columns(db, 'readings')
    if (!sCols.includes('id') || !sCols.includes('start_time') || !rCols.includes('session_id') || !rCols.includes('timestamp') || !rCols.includes('spo2'))
      throw new ImportError('This database is not from the O2 desktop app (no sessions / readings tables found).')
    const hrCol = rCols.includes('hr') ? 'hr' : rCols.includes('pulse') ? 'pulse' : null

    const notes = new Map<string, string>()
    if (columns(db, 'daily_notes').includes('date')) {
      for (const [d, t] of db.exec('SELECT date, notes FROM daily_notes')[0]?.values ?? []) {
        if (typeof d === 'string' && typeof t === 'string' && t.trim()) notes.set(d.slice(0, 10), t.trim())
      }
    }

    const sessions = db.exec(`SELECT id, start_time, ${sCols.includes('label') ? 'label' : "''"} FROM sessions ORDER BY start_time`)[0]?.values ?? []
    const stmt = db.prepare(`SELECT timestamp, spo2, ${hrCol ?? 'NULL'} FROM readings WHERE session_id = ? ORDER BY timestamp`)
    const nights: ImportNight[] = []
    const failed: ImportFailure[] = []
    sessions.forEach(([id, startText, label], k) => {
      const labelStr = typeof label === 'string' ? label : ''
      const name = /(\d{14})/.exec(labelStr)?.[1]
      const shown = name || String(startText)
      try {
        const ts: number[] = []
        const sp: (number | null)[] = []
        const hr: (number | null)[] = []
        stmt.bind([id as number])
        while (stmt.step()) {
          const [t, s, h] = stmt.get()
          const ms = typeof t === 'string' ? parseLocalStamp(t) : typeof t === 'number' ? (t > 1e12 ? t : t * 1000) : NaN
          if (!Number.isFinite(ms)) continue
          ts.push(ms)
          sp.push(typeof s === 'number' ? s : null)
          hr.push(typeof h === 'number' ? h : null)
        }
        stmt.reset()
        if (ts.length === 0) throw new Error('no readings')
        // Interval = most common spacing (whole seconds); the O2 family records every 2 or 4 s.
        const counts = new Map<number, number>()
        for (let i = 1; i < ts.length; i++) {
          const d = Math.round((ts[i] - ts[i - 1]) / 1000)
          if (d > 0) counts.set(d, (counts.get(d) ?? 0) + 1)
        }
        let dt = 4
        let best = 0
        for (const [d, c] of counts) if (c > best && d <= 60) [dt, best] = [d, c]
        const first = ts[0]
        const spanSec = (ts[ts.length - 1] - first) / 1000
        if (spanSec > MAX_NIGHT_SEC) throw new Error(`timestamps span ${Math.round(spanSec / 3600)} hours`)
        const n = Math.round(spanSec / dt) + 1
        const spo2 = new Array<number | null>(n).fill(null)
        const pulse = new Array<number | null>(n).fill(null)
        for (let i = 0; i < ts.length; i++) {
          const j = Math.round((ts[i] - first) / 1000 / dt)
          if (j < 0 || j >= n || spo2[j] != null || pulse[j] != null) continue
          spo2[j] = sp[i]
          pulse[j] = hr[i]
        }
        // The grid is anchored on the first reading (the session start_time is the same moment in practice).
        const night: ImportNight = { fileName: name || fileNameFor(first), start: first, intervalSec: dt, spo2, pulse }
        nights.push(night)
      } catch (e) {
        stmt.reset()
        failed.push({ label: shown, error: e instanceof Error ? e.message : String(e) })
      }
      onProgress?.(k + 1, sessions.length)
    })
    stmt.free()
    // A daily note belongs to that evening's main recording (the longest one), not to naps or short test recordings.
    const main = new Map<string, ImportNight>()
    for (const n of nights) {
      const d = eveningDate(n.start)
      const cur = main.get(d)
      if (!cur || n.spo2.length > cur.spo2.length) main.set(d, n)
    }
    for (const [d, n] of main) {
      const note = notes.get(d)
      if (note) n.notes = note
    }
    return { kind: 'desktop-db', nights, failed }
  } finally {
    db.close()
  }
}
