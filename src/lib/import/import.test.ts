import 'fake-indexeddb/auto'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { buildImport } from './build'
import { readDesktopDb, isSqlite } from './desktopDb'
import { EXPORT_FORMAT, formatLocalStamp, parseLocalStamp, parseO2VibeJson, toO2VibeJson } from './format'
import { saveBuilt } from './importer'
import { fromRecording, listSessions, saveSession } from '../../db/sessions'
import { encodeO2File, parseO2File } from '../viatom/file'
import { makeDesktopDb, syntheticNight, type FakeNight } from './__fixtures__/makeDesktopDb'

const loadSql = () => initSqlJs()

describe('desktop app database import', () => {
  it('rebuilds a regular grid, keeps gaps as missing samples and attaches notes', async () => {
    const start = new Date(2025, 2, 3, 23, 5, 10)
    const night: FakeNight = {
      start,
      samples: [[96, 60], [95, 61], undefined, undefined, [0, 0], [255, 255], [94, 59], [93, 58]],
    }
    const bytes = await makeDesktopDb([night], { '2025-03-03': '• note for this night' })
    expect(isSqlite(bytes)).toBe(true)
    const r = readDesktopDb(await loadSql(), bytes)
    expect(r.failed).toEqual([])
    expect(r.nights).toHaveLength(1)
    const n = r.nights[0]
    expect(n.fileName).toBe('20250303230510')
    expect(n.start).toBe(start.getTime())
    expect(n.intervalSec).toBe(4)
    expect(n.spo2).toEqual([96, 95, null, null, 0, 255, 94, 93])
    expect(n.pulse).toEqual([60, 61, null, null, 0, 255, 59, 58])
    expect(n.notes).toBe('• note for this night')
  })

  it('computes stats with the normal invalid-sample filtering', async () => {
    const bytes = await makeDesktopDb([
      { start: new Date(2025, 2, 4, 22, 0, 0), samples: [[0, 0], [97, 60], [255, 255], [96, 62], [127, null]] },
    ])
    const b = await buildImport(bytes, loadSql)
    const st = b.sessions[0].stats
    expect(st.minSpo2).toBe(96)
    expect(st.avgPulse).toBe(61)
    expect(b.sessions[0].source).toBe('import')
    expect(b.sessions[0].id).toBe('import:20250304220000')
  })

  it('handles a realistic multi-night file and reports empty sessions as failed', async () => {
    const SQL = await loadSql()
    const bytes = await makeDesktopDb(
      [syntheticNight(new Date(2025, 2, 10, 23, 15, 0), 60, 84), syntheticNight(new Date(2025, 2, 11, 8, 40, 0), 10), syntheticNight(new Date(2025, 2, 11, 22, 45, 30), 90, 92)],
      { '2025-03-10': 'synthetic note' },
    )
    // add a session with no readings
    const db = new SQL.Database(bytes)
    db.run("INSERT INTO sessions (start_time, end_time, label) VALUES ('2025-03-12T07:00:00', NULL, 'Downloaded: 20250312070000')")
    const withEmpty = db.export()
    db.close()
    const progress: string[] = []
    const b = await buildImport(withEmpty, loadSql, (p) => progress.push(p.stage))
    expect(b.kind).toBe('desktop-db')
    expect(b.sessions.map((s) => s.fileName)).toEqual(['20250310231500', '20250311084000', '20250311224530'])
    // the note goes to the main night only, not the short morning recording
    expect(b.sessions.map((s) => s.notes ?? null)).toEqual(['synthetic note', null, null])
    expect(b.failed).toEqual([{ label: '20250312070000', error: 'no readings' }])
    expect(b.sessions[0].stats.minSpo2).toBe(84)
    expect(b.sessions[0].stats.level).toBeGreaterThanOrEqual(2)
    expect(b.sessions[2].stats.durationSec).toBeCloseTo(90 * 60, -2)
    expect(progress).toContain('parsing')
    expect(progress).toContain('analysing')
  })

  it('rejects databases from other apps and unknown files', async () => {
    const SQL = await loadSql()
    const db = new SQL.Database()
    db.run('CREATE TABLE things (id INTEGER)')
    await expect(buildImport(db.export(), loadSql)).rejects.toThrow(/not from the O2 desktop app/)
    await expect(buildImport(new TextEncoder().encode('hello'), loadSql)).rejects.toThrow(/Unsupported file/)
  })
})

describe('.o2vibe.json', () => {
  it('round-trips nights and validates input', () => {
    const start = new Date(2025, 2, 20, 23, 30, 15).getTime()
    const json = toO2VibeJson([{ fileName: '20250320233015', start, intervalSec: 4, spo2: [95, null, 88], pulse: [50, null, 41], notes: 'synthetic note' }])
    const obj = JSON.parse(json)
    expect(obj.format).toBe(EXPORT_FORMAT)
    expect(obj.version).toBe(1)
    expect(obj.nights[0].start).toBe('2025-03-20T23:30:15')
    const back = parseO2VibeJson(json)
    expect(back.nights[0]).toMatchObject({ fileName: '20250320233015', start, intervalSec: 4, spo2: [95, null, 88], pulse: [50, null, 41], notes: 'synthetic note' })
    expect(() => parseO2VibeJson('{"format":"other","nights":[]}')).toThrow(/not an O2 Vibe export/)
    expect(() => parseO2VibeJson(JSON.stringify({ format: EXPORT_FORMAT, version: 99, nights: [] }))).toThrow(/newer version/)
    const bad = parseO2VibeJson(JSON.stringify({ format: EXPORT_FORMAT, version: 1, nights: [{ start: 'yesterday', intervalSec: 4, spo2: [1], pulse: [1] }] }))
    expect(bad.failed[0].error).toMatch(/start time/)
  })

  it('parses local stamps as local time', () => {
    expect(parseLocalStamp('2025-03-20T23:30:15')).toBe(new Date(2025, 2, 20, 23, 30, 15).getTime())
    expect(parseLocalStamp('2025-06-15 21:05')).toBe(new Date(2025, 5, 15, 21, 5, 0).getTime())
    expect(parseLocalStamp('2026-10-10T05:00:00Z')).toBe(Date.UTC(2026, 9, 10, 5))
    expect(formatLocalStamp(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe('2026-01-02T03:04:05')
  })
})

describe('import de-duplication', () => {
  it('skips nights already downloaded over Bluetooth and re-imports', async () => {
    const start = new Date(2025, 3, 2, 23, 20, 0)
    // The phone already pulled this night from the device.
    const rec = parseO2File(encodeO2File({ start, intervalSec: 4, spo2: [96, 95, 94, 93], pulse: [60, 61, 62, 63] }))
    expect(await saveSession(fromRecording(rec, { source: 'device', deviceName: 'O2 Vibe 1234', serial: 'SN1', fileName: '20250402232000' }))).toBe(true)

    const bytes = await makeDesktopDb([
      { start, samples: [[96, 60], [95, 61], undefined, [93, 63], [92, 64]] }, // same night, different length
      syntheticNight(new Date(2025, 3, 1, 22, 50, 0), 30),
    ])
    const first = await saveBuilt(await buildImport(bytes, loadSql))
    expect(first).toMatchObject({ found: 2, imported: 1, skipped: 1 })
    expect(first.first).toBe(new Date(2025, 3, 1, 22, 50, 0).getTime())
    const again = await saveBuilt(await buildImport(bytes, loadSql))
    expect(again).toMatchObject({ imported: 0, skipped: 2 })
    const all = await listSessions()
    expect(all.map((s) => s.source)).toEqual(['device', 'import'])

    // A later Bluetooth download of a night that was imported first is skipped too.
    const rec2 = parseO2File(encodeO2File({ start: new Date(2025, 3, 1, 22, 50, 0), intervalSec: 4, spo2: [96], pulse: [60] }))
    expect(await saveSession(fromRecording(rec2, { source: 'device', deviceName: 'O2 Vibe 1234', serial: 'SN1', fileName: '20250401225000' }))).toBe(false)
  })
})
