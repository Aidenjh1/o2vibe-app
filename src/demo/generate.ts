/** Deterministic, physiologically plausible overnight oximetry for demo mode. */

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 'hypoxic' resembles a real reported night: avg ~93%, nadir ~84%, ~10 drops/h, resting pulse 40–48. */
export type NightProfile = 'calm' | 'mild' | 'moderate' | 'hypoxic'

export interface SimNight {
  start: Date
  intervalSec: number
  spo2: (number | null)[]
  pulse: (number | null)[]
  motion: number[]
}

export function simulateNight(opts: { start: Date; hours: number; profile: NightProfile; seed: number; intervalSec?: number }): SimNight {
  const rnd = mulberry32(opts.seed)
  const gauss = () => {
    let u = 0
    let v = 0
    while (u === 0) u = rnd()
    while (v === 0) v = rnd()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  const dt = opts.intervalSec ?? 4
  const n = Math.round((opts.hours * 3600) / dt)
  const hyp = opts.profile === 'hypoxic'
  const eventRatePerHour = { calm: 1.5, mild: 6, moderate: 16, hypoxic: 9 }[opts.profile]
  const depth = { calm: [3, 5], mild: [4, 8], moderate: [5, 12], hypoxic: [3, 5] }[opts.profile]
  const baseSpo2 = { calm: 96.6, mild: 95.6, moderate: 94.4, hypoxic: 93.9 }[opts.profile] + gauss() * 0.4
  const baseHr = hyp ? 44 + rnd() * 2 : 58 + rnd() * 8

  const spo2: (number | null)[] = []
  const pulse: (number | null)[] = []
  const motion: number[] = []

  let drift = 0
  let hrDrift = 0
  let event = 0 // remaining samples in desaturation event
  let eventLen = 0
  let eventDepth = 0
  let gap = 0
  let hrSpike = 0
  for (let i = 0; i < n; i++) {
    const hour = (i * dt) / 3600
    // ~90-min sleep cycles: REM periods (later in the night) get more events and a higher pulse.
    const cycle = (hour % 1.5) / 1.5
    const rem = cycle > 0.75 ? 1 + hour / opts.hours : 0
    const settling = hour < 0.4 ? (0.4 - hour) * 10 : 0 // falling asleep: restless, higher HR
    const waking = hour > opts.hours - 0.3 ? (hour - (opts.hours - 0.3)) * 12 : 0

    drift += gauss() * 0.04 - drift * 0.01
    hrDrift += gauss() * 0.15 - hrDrift * 0.02

    const pEvent = ((eventRatePerHour * (1 + rem)) / 3600) * dt
    if (event <= 0 && gap <= 0 && rnd() < pEvent) {
      eventLen = Math.round((20 + rnd() * 40) / dt)
      eventDepth = depth[0] + rnd() * (depth[1] - depth[0])
      event = eventLen
    }

    let s = baseSpo2 + drift + gauss() * 0.45 - waking * 0.2
    let hr = baseHr + hrDrift + gauss() * 1.2 + rem * 3 + settling * 2.5 + waking * 6
    if (hyp) {
      // Long REM stretch late in the night with a lower baseline and a few deep desaturations.
      const f = hour / opts.hours
      if (f > 0.62 && f < 0.74) s -= 1.2 + Math.sin(((f - 0.62) / 0.12) * Math.PI) * 1.0
      if (f > 0.66 && f < 0.7 && event <= 0 && gap <= 0 && rnd() < 0.05) {
        eventLen = Math.round((45 + rnd() * 50) / dt)
        eventDepth = 5.5 + rnd() * 2.5
        event = eventLen
      }
      hr -= rem * 3 // pulse stays low in this profile
      if (rnd() < 0.002) hrSpike = Math.round((40 + rnd() * 50) / dt)
      if (hrSpike > 0) {
        hr += 22 + 10 * Math.sin((hrSpike * dt) / 20)
        hrSpike--
      }
    }
    if (event > 0) {
      const phase = 1 - event / eventLen // 0..1
      const shape = Math.sin(Math.PI * Math.min(1, phase * 1.25)) // fall then recover
      s -= eventDepth * Math.max(0, shape)
      hr += phase > 0.7 ? 8 * shape + 4 : -2 * shape // arousal bump at recovery
      event--
    }

    let m = Math.max(0, Math.round((settling + waking) * 3 + (rnd() < 0.01 ? 10 + rnd() * 30 : 0) + gauss()))
    // Occasional signal dropouts (sensor shifted), more when moving.
    if (gap <= 0 && rnd() < 0.0006 + m * 0.0002) gap = Math.round((15 + rnd() * 90) / dt)
    if (gap > 0) {
      gap--
      spo2.push(null)
      pulse.push(null)
      motion.push(Math.min(255, m + 5))
      continue
    }
    m = Math.min(255, m)
    spo2.push(Math.max(70, Math.min(100, Math.round(s))))
    pulse.push(Math.max(40, Math.min(140, Math.round(hr))))
    motion.push(m)
  }
  return { start: opts.start, intervalSec: dt, spo2, pulse, motion }
}

/** A week of nights ending last night, newest last (matches device file order). */
export function demoNights(now = new Date()): SimNight[] {
  // Newest last. "Last night" is the hypoxic profile so the warning UI is visible straight away in demo mode.
  const profiles: NightProfile[] = ['calm', 'mild', 'calm', 'moderate', 'calm', 'mild', 'hypoxic']
  const nights: SimNight[] = []
  for (let k = profiles.length; k >= 1; k--) {
    const d = new Date(now)
    d.setDate(d.getDate() - k)
    const seed = 1000 + d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate()
    // The hypoxic night uses a fixed seed so demo mode always shows the same, realistic warning case.
    const nightSeed = profiles[profiles.length - k] === 'hypoxic' ? 811703 : seed
    const r = mulberry32(seed)
    d.setHours(22, Math.floor(r() * 60) + (r() < 0.5 ? 0 : 45), Math.floor(r() * 60), 0)
    const hours = profiles[profiles.length - k] === 'hypoxic' ? 8.5 : 6.2 + r() * 2.2
    nights.push(simulateNight({ start: d, hours, profile: profiles[profiles.length - k], seed: nightSeed }))
  }
  return nights
}

/** One cardiac-cycle-shaped pleth sample, phase 0..1 → 0..1. */
export function plethShape(phase: number): number {
  const systolic = Math.exp(-Math.pow((phase - 0.18) / 0.08, 2))
  const dicrotic = 0.38 * Math.exp(-Math.pow((phase - 0.48) / 0.1, 2))
  return 0.12 + 0.78 * (systolic + dicrotic) / 1.05
}
