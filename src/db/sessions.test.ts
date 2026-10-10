import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { deleteSession, fromRecording, getSession, listSessions, saveSession } from './sessions'
import { parseO2File, encodeO2File } from '../lib/viatom/file'
import { sessionToCsv } from '../lib/csv'

const rec = (h: number) =>
  parseO2File(encodeO2File({ start: new Date(2026, 9, 9, h, 0, 0), intervalSec: 4, spo2: [96, 95, null, 89], pulse: [60, 61, null, 70] }))

describe('session storage', () => {
  it('saves, dedupes, lists newest first, exports CSV and deletes', async () => {
    const a = fromRecording(rec(22), { source: 'device', deviceName: 'O2 Vibe 1234', serial: 'SN1', fileName: '20261009220000' })
    const b = fromRecording(rec(23), { source: 'device', deviceName: 'O2 Vibe 1234', serial: 'SN1', fileName: '20261009230000' })
    expect(await saveSession(a)).toBe(true)
    expect(await saveSession(a)).toBe(false)
    // same night imported under a different name → still deduped by start time
    expect(await saveSession({ ...a, id: 'other:20261009220000' })).toBe(false)
    expect(await saveSession(b)).toBe(true)
    const list = await listSessions()
    expect(list.map((s) => s.fileName)).toEqual(['20261009230000', '20261009220000'])
    const csv = sessionToCsv((await getSession(a.id))!)
    expect(csv.split('\n')[0]).toBe('time,spo2_percent,pulse_bpm,motion')
    expect(csv.split('\n')[1]).toBe('2026-10-09 22:00:00,96,60,0')
    expect(csv.split('\n')[3]).toBe('2026-10-09 22:00:08,,,0')
    await deleteSession(a.id)
    expect((await listSessions()).length).toBe(1)
  })
})
