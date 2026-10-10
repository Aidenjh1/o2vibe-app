import { describe, expect, it } from 'vitest'
import { cleanSpo2, computeStats, findDrops, findEpisodes, insights, odiBand, pulseZone, spo2Zone, warningSummary } from './analytics'
import { demoNights, simulateNight } from '../demo/generate'

const START = new Date(2026, 9, 9, 23).getTime()
const series = (spo2: (number | null)[], pulse?: (number | null)[], intervalSec = 4) => ({
  start: START,
  intervalSec,
  spo2,
  pulse: pulse ?? spo2.map((v) => (v == null ? null : 60)),
})
const fill = (n: number, v: number | null) => Array<number | null>(n).fill(v)
/** n samples (4 s each) of a smooth dip: from base down to `to`, held `hold` samples, back to base. */
const dip = (base: number, to: number, hold: number) => {
  const down = [base - 1, base - 2, base - 3].filter((v) => v > to)
  return [...down, ...fill(hold, to), ...[...down].reverse()]
}

describe('zones', () => {
  it('uses the agreed SpO2 bands (green ≥95, amber 90–94, orange-red 88–89, deep red <88)', () => {
    expect(spo2Zone(100).tone).toBe('good')
    expect(spo2Zone(95).tone).toBe('good')
    expect(spo2Zone(94).tone).toBe('warn')
    expect(spo2Zone(90).tone).toBe('warn')
    expect(spo2Zone(89).tone).toBe('bad')
    expect(spo2Zone(88).tone).toBe('bad')
    expect(spo2Zone(87).tone).toBe('critical')
    expect(spo2Zone(null).tone).toBe('none')
  })
  it('classifies pulse', () => {
    expect(pulseZone(70).tone).toBe('good')
    expect(pulseZone(45).tone).toBe('warn')
    expect(pulseZone(130).tone).toBe('bad')
  })
  it('uses standard ODI bands', () => {
    expect(odiBand(4.9).label).toBe('normal')
    expect(odiBand(5).label).toBe('mild')
    expect(odiBand(10).label).toBe('mild')
    expect(odiBand(15).label).toBe('moderate')
    expect(odiBand(30).label).toBe('severe')
  })
})

describe('invalid samples', () => {
  it('treats 0, 255, out-of-range and null as no signal', () => {
    expect(cleanSpo2([0, 255, 127, 49, 50, 97, 100, 101, null])).toEqual([null, null, null, null, 50, 97, 100, null, null])
  })
  it('sensor-off zeros never create a false low and are reported as bad signal', () => {
    const spo2 = [...fill(200, 96), ...fill(50, 0), ...fill(50, 255), ...fill(200, 96)]
    const st = computeStats(series(spo2))
    expect(st.minSpo2).toBe(96)
    expect(st.timeBelow90Sec).toBe(0)
    expect(st.episodesBelow90).toBe(0)
    expect(st.badSignalSec).toBe(100 * 4)
    expect(st.pctBadSignal).toBeCloseTo(20, 5)
    expect(st.rating).toBe('good')
    expect(st.findings.some((f) => f.key === 'signal')).toBe(true)
  })
  it('invalid samples do not hide a real low next to them', () => {
    const spo2 = [...fill(200, 96), ...fill(10, 0), ...dip(96, 84, 10), ...fill(10, 255), ...fill(200, 96)]
    const st = computeStats(series(spo2))
    expect(st.minSpo2).toBe(84)
    expect(st.rating).toBe('very-low')
  })
  it('a dropout in the middle of a desaturation is not counted as a drop', () => {
    const spo2 = [...fill(60, 96), 92, 92, 0, 0, 92, 92, ...fill(60, 96)]
    expect(findDrops(series(spo2))).toHaveLength(0)
  })
})

describe('nadir, T90/T88 and episodes', () => {
  it('counts time below each threshold', () => {
    // 10 samples (40 s) at 89, 10 at 87, 10 at 84, 10 at 79
    const spo2 = [...fill(100, 96), ...fill(10, 89), ...fill(10, 87), ...fill(10, 84), ...fill(10, 79), ...fill(100, 96)]
    const st = computeStats(series(spo2))
    expect(st.timeBelow90Sec).toBe(160)
    expect(st.timeBelow88Sec).toBe(120)
    expect(st.timeBelow85Sec).toBe(80)
    expect(st.timeBelow80Sec).toBe(40)
    expect(st.timeLowSec).toBe(40)
    expect(st.timeVeryLowSec).toBe(120)
    expect(st.minSpo2).toBe(79)
    expect(st.minSpo2At).toBe(START + 130 * 4000)
  })
  it('requires the nadir to be held ~8 s, so one-sample glitches are ignored', () => {
    const spo2 = [...fill(30, 97), 70, ...fill(30, 97), null, null]
    const st = computeStats(series(spo2))
    expect(st.minSpo2).toBe(97)
    expect(st.validSec).toBe(61 * 4)
  })
  it('finds episodes under 90%, with duration, nadir and the longest one', () => {
    const spo2 = [...fill(60, 96), ...dip(96, 88, 5), ...fill(60, 96), ...dip(96, 85, 40), ...fill(60, 96)]
    const st = computeStats(series(spo2))
    expect(st.episodesBelow90).toBe(2)
    expect(st.episodes.map((e) => e.nadir)).toEqual([88, 85])
    expect(st.episodes[0].durationSec).toBe(5 * 4)
    expect(st.longestBelow90Sec).toBe(40 * 4)
    expect(st.longestBelow88Sec).toBe(40 * 4)
    expect(st.episodes[1].start).toBe(START + (60 + 6 + 5 + 60 + 3) * 4000)
  })
  it('bridges a single sample back above 90 inside an episode', () => {
    const v = [96, 89, 88, 90, 88, 89, 96]
    const eps = findEpisodes(v, START, 4, (x) => x < 90, 1, 1)
    expect(eps).toHaveLength(1)
    expect(eps[0].durationSec).toBe(5 * 4)
  })
})

describe('ODI', () => {
  it('counts ≥3% and ≥4% drops lasting ≥10 s', () => {
    const three = [...fill(40, 96), ...fill(4, 93), ...fill(40, 96)]
    const four = [...fill(40, 96), ...fill(4, 92), ...fill(40, 96)]
    const st = computeStats(series([...three, ...four, ...three]))
    expect(st.drops).toBe(3)
    expect(st.drops4).toBe(1)
    const hours = st.validSec / 3600
    expect(st.dropsPerHour).toBeCloseTo(3 / hours, 5)
    expect(st.odi4).toBeCloseTo(1 / hours, 5)
  })
  it('a 4-second blip is not a drop', () => {
    const spo2 = [...fill(40, 96), 93, 96, ...fill(40, 96)]
    expect(findDrops(series(spo2))).toHaveLength(0)
  })
})

describe('rating never reassures when a danger criterion is met', () => {
  const hours = (h: number) => Math.round((h * 3600) / 4)
  const goodNight = () => fill(hours(7), 96)

  it('a perfect night is good', () => {
    expect(computeStats(series(goodNight())).rating).toBe('good')
  })
  it('one sustained dip to 89% in an otherwise perfect night is red, with a banner', () => {
    const s = goodNight()
    s.splice(3000, 3, 89, 89, 89)
    const st = computeStats(series(s))
    expect(st.minSpo2).toBe(89)
    expect(st.level).toBeGreaterThanOrEqual(2)
    expect(st.rating).toBe('low')
    const w = warningSummary(st)!
    expect(w).not.toBeNull()
    expect(w.advice).toMatch(/doctor/)
  })
  it('a nadir under 85% is the strongest level even if everything else is normal', () => {
    const s = goodNight()
    s.splice(3000, 3, 84, 84, 84)
    const st = computeStats(series(s))
    expect(st.level).toBe(3)
    expect(st.rating).toBe('very-low')
    expect(warningSummary(st)!.headline).toBe('Very low oxygen detected')
    expect(warningSummary(st)!.advice).toMatch(/911/)
  })
  it('≥5 min under 88% is the strongest level', () => {
    const s = goodNight()
    for (let i = 0; i < 80; i += 20) s.splice(2000 + i * 50, 20, ...fill(20, 87)) // 4 × 80 s = 5.3 min at 87%
    expect(computeStats(series(s)).level).toBe(3)
  })
  it('T90 ≥ 1 min alone is red', () => {
    const s = goodNight()
    for (let k = 0; k < 8; k++) s.splice(1000 + k * 500, 2, 89, 89) // 8 × 8 s = 64 s
    const st = computeStats(series(s))
    expect(st.timeBelow90Sec).toBe(64)
    expect(st.level).toBeGreaterThanOrEqual(2)
  })
  it('the worst criterion drives the rating, regardless of average and ODI', () => {
    const s = goodNight()
    s.splice(3000, 4, 86, 86, 86, 86)
    const st = computeStats(series(s))
    expect(st.avgSpo2!).toBeGreaterThan(95)
    expect(st.dropsPerHour).toBeLessThan(1)
    expect(st.rating).not.toBe('good')
    expect(st.rating).not.toBe('fair')
    expect(st.findings[0].key).toBe('nadir')
  })
  it('flags slow heart rate (avg < 50) and pulse under 40', () => {
    const n = hours(2)
    const pulse = fill(n, 46)
    pulse.splice(500, 10, ...fill(10, 38)) // 40 s under 40
    const st = computeStats(series(fill(n, 96), pulse))
    const hr = st.findings.find((f) => f.key === 'hr-low')!
    expect(hr).toBeTruthy()
    expect(hr.level).toBe(2)
    expect(st.minPulse).toBe(38)
    expect(st.timePulseBelow40Sec).toBe(40)
  })
  it('a low resting average (48 bpm) with no lows under 40 is noted but stays amber', () => {
    const n = hours(2)
    const st = computeStats(series(fill(n, 96), fill(n, 48)))
    expect(st.findings.find((f) => f.key === 'hr-low')!.level).toBe(1)
    expect(st.rating).toBe('fair')
  })
})

describe('simulated nights', () => {
  it('rates calm vs moderate sensibly', () => {
    const calm = computeStats({ ...simulateNight({ start: new Date(2026, 0, 1, 23), hours: 7, profile: 'calm', seed: 11 }), start: 0 })
    const bad = computeStats({ ...simulateNight({ start: new Date(2026, 0, 1, 23), hours: 7, profile: 'moderate', seed: 11 }), start: 0 })
    expect(calm.dropsPerHour).toBeLessThan(bad.dropsPerHour)
    expect(calm.rating).toBe('good')
    expect(bad.rating).not.toBe('good')
  })
  it('the "hypoxic" demo night resembles a real low night and triggers the strongest warning', () => {
    const n = demoNights(new Date(2026, 9, 10, 9)).at(-1)!
    const st = computeStats({ ...n, start: n.start.getTime() })
    expect(st.minSpo2!).toBeLessThanOrEqual(85)
    expect(st.dropsPerHour).toBeGreaterThan(7)
    expect(st.dropsPerHour).toBeLessThan(14)
    expect(st.avgPulse!).toBeLessThan(50)
    expect(st.level).toBe(3)
    expect(warningSummary(st)).not.toBeNull()
  })
  it('produces plain-English insights', () => {
    const n = simulateNight({ start: new Date(2026, 0, 1, 23), hours: 7, profile: 'mild', seed: 5 })
    const s = { ...n, start: n.start.getTime() }
    const list = insights(s, computeStats(s))
    expect(list.length).toBeGreaterThanOrEqual(4)
    expect(list.map((i) => i.text).join(' ')).toMatch(/per hour/)
  })
})
