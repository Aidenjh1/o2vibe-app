import initSqlJs from 'sql.js'

/** Same schema as the O2 desktop app database. Synthetic data only — never real recordings. */
export const DESKTOP_SCHEMA = `
CREATE TABLE sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, start_time TEXT NOT NULL, end_time TEXT, label TEXT, notes TEXT);
CREATE TABLE readings (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, timestamp TEXT NOT NULL, spo2 INTEGER, hr INTEGER, pi REAL, battery INTEGER, FOREIGN KEY (session_id) REFERENCES sessions(id));
CREATE INDEX idx_readings_session ON readings(session_id);
CREATE INDEX idx_readings_ts ON readings(timestamp);
CREATE TABLE daily_notes (date TEXT PRIMARY KEY, notes TEXT);
`

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
const name = (d: Date) => stamp(d).replace(/[-T:]/g, '')

export interface FakeNight {
  start: Date
  /** Per-sample [spo2, hr]; `undefined` = row missing (the desktop app drops invalid samples). */
  samples: ([number | null, number | null] | undefined)[]
  intervalSec?: number
}

export async function makeDesktopDb(nights: FakeNight[], notes: Record<string, string> = {}): Promise<Uint8Array> {
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  db.run(DESKTOP_SCHEMA)
  for (const n of nights) {
    const dt = n.intervalSec ?? 4
    const end = new Date(n.start.getTime() + (n.samples.length - 1) * dt * 1000)
    db.run('INSERT INTO sessions (start_time, end_time, label) VALUES (?, ?, ?)', [stamp(n.start), stamp(end), `Downloaded: ${name(n.start)}`])
    const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
    n.samples.forEach((s, i) => {
      if (!s) return
      db.run('INSERT INTO readings (session_id, timestamp, spo2, hr, pi, battery) VALUES (?, ?, ?, ?, 0.0, NULL)', [id, stamp(new Date(n.start.getTime() + i * dt * 1000)), s[0], s[1]])
    })
  }
  for (const [d, t] of Object.entries(notes)) db.run('INSERT INTO daily_notes (date, notes) VALUES (?, ?)', [d, t])
  const bytes = db.export()
  db.close()
  return bytes
}

/** A plausible synthetic night: steady 95–96% with a dip to `nadir` near the middle. */
export function syntheticNight(start: Date, minutes: number, nadir = 86): FakeNight {
  const n = Math.round((minutes * 60) / 4)
  const samples: FakeNight['samples'] = []
  for (let i = 0; i < n; i++) {
    const mid = Math.abs(i - n / 2)
    const spo2 = mid < 15 ? Math.max(nadir, 95 - (15 - mid)) : 95 + (i % 2)
    samples.push([spo2, 55 + (i % 7)])
  }
  return { start, samples }
}
