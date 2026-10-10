import { describe, expect, it } from 'vitest'
import { computeStats, findDrops, insights, pulseZone, spo2Zone } from './analytics'
import { simulateNight } from '../demo/generate'

const series = (spo2: (number | null)[], pulse?: (number | null)[], intervalSec = 4) => ({
  start: new Date(2026, 9, 9, 23).getTime(),
  intervalSec,
  spo2,
  pulse: pulse ?? spo2.map((v) => (v == null ? null : 60)),
})

describe('zones', () => {
  it('uses the agreed SpO2 bands', () => {
    expect(spo2Zone(100).label).toBe('Normal')
    expect(spo2Zone(95).label).toBe('Normal')
    expect(spo2Zone(94).label).toBe('A bit low')
    expect(spo2Zone(90).label).toBe('A bit low')
    expect(spo2Zone(89).label).toBe('Low')
    expect(spo2Zone(null).tone).toBe('none')
  })
  it('classifies pulse', () => {
    expect(pulseZone(70).tone).toBe('good')
    expect(pulseZone(45).tone).toBe('warn')
    expect(pulseZone(130).tone).toBe('bad')
  })
})

describe('session stats', () => {
  it('counts time below 90, drops and HR range', () => {
    const base = Array(60).fill(96)
    const dip = [96, 94, 92, 89, 88, 88, 90, 93, 96]
    const spo2 = [...base, ...dip, ...base, ...dip, ...base]
    const st = computeStats(series(spo2))
    expect(st.timeBelow90Sec).toBe(6 * 4)
    expect(st.drops).toBe(2)
    expect(st.minSpo2).toBe(88)
    expect(st.episodesBelow90).toBe(2)
    expect(st.avgPulse).toBe(60)
  })
  it('ignores single-sample glitches for min values and gaps for averages', () => {
    const spo2 = [...Array(30).fill(97), 70, ...Array(30).fill(97), null, null]
    const st = computeStats(series(spo2))
    expect(st.minSpo2).toBe(97)
    expect(st.validSec).toBe(61 * 4)
  })
  it('rates simulated nights sensibly', () => {
    const calm = computeStats({ ...simulateNight({ start: new Date(2026, 0, 1, 23), hours: 7, profile: 'calm', seed: 11 }), start: 0 })
    const bad = computeStats({ ...simulateNight({ start: new Date(2026, 0, 1, 23), hours: 7, profile: 'moderate', seed: 11 }), start: 0 })
    expect(calm.dropsPerHour).toBeLessThan(bad.dropsPerHour)
    expect(calm.rating).toBe('good')
    expect(bad.rating).not.toBe('good')
  })
  it('findDrops requires a sustained fall of 3+ points', () => {
    const spo2 = [...Array(40).fill(96), 93, 96, ...Array(40).fill(96)]
    expect(findDrops(series(spo2))).toHaveLength(0) // one 4-second blip < 10 s
  })
  it('produces plain-English insights', () => {
    const n = simulateNight({ start: new Date(2026, 0, 1, 23), hours: 7, profile: 'mild', seed: 5 })
    const s = { ...n, start: n.start.getTime() }
    const list = insights(s, computeStats(s))
    expect(list.length).toBeGreaterThanOrEqual(4)
    expect(list.map((i) => i.text).join(' ')).toMatch(/per hour/)
  })
})
