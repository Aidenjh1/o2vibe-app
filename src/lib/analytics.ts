/**
 * Overnight oximetry analysis.
 *
 * Every number shown in the app comes from here. The rules are deliberately conservative: the worst criterion
 * always drives the night's rating, so a reassuring label can never sit next to a dangerous low.
 * Thresholds are collected in THRESHOLDS (and documented in the README) so they are easy to review.
 */

export type Tone = 'good' | 'warn' | 'bad' | 'critical' | 'none'
/** 0 normal · 1 worth watching · 2 low (red) · 3 very low (deep red, strongest wording). */
export type Level = 0 | 1 | 2 | 3
export const levelTone: Record<Level, Tone> = { 0: 'good', 1: 'warn', 2: 'bad', 3: 'critical' }

export const THRESHOLDS = {
  /** Samples outside these ranges are treated as "no reliable signal" (0, 255, sensor off, artefacts). */
  spo2Valid: [50, 100] as const,
  pulseValid: [25, 250] as const,
  /** A low only counts as the nadir if it is held for this long (filters single-sample glitches). */
  sustainSec: 8,
  /** Gaps up to this long inside an episode are bridged (e.g. one 4-second sample back at 90%). */
  bridgeSec: 4,
  /** Desaturation event = fall of ≥3 (or ≥4) points below the 2-minute baseline lasting ≥10 s. */
  desatMinSec: 10,
  baselineSec: 120,
  /** ODI severity bands (events per hour), the standard AHI/ODI cut-offs. */
  odiBands: [5, 15, 30] as const,
  nadirLow: 90, // nadir < 90 → red
  nadirVeryLow: 85, // nadir < 85 → deep red, strongest wording
  t90BadMin: 1, // ≥ 1 min under 90% → red
  t90BadPct: 1, // or ≥ 1% of the night
  t90CritMin: 30, // ≥ 30 min under 90% → deep red
  t90CritPct: 10, // or ≥ 10% of the night
  t88CritMin: 5, // ≥ 5 min under 88% → deep red (cf. the ≤88% for ≥5 min nocturnal-oxygen criterion)
  t85CritMin: 1, // ≥ 1 min under 85% → deep red
  longest90BadMin: 2, // a single continuous stretch under 90% of ≥ 2 min → red
  longest90CritMin: 5, // ≥ 5 min → deep red
  avgWarn: 94, // average SpO2 below 94% → amber
  avgBad: 92, // below 92% → red
  avgCrit: 90, // below 90% → deep red
  hrBradyAvg: 50, // average pulse below 50 → amber note
  hrBradyLongestMin: 5, // or a continuous stretch under 50 of ≥ 5 min → amber note
  hrVeryLow: 40, // under 40 for ≥ 30 s continuous → red
  hrVeryLowSec: 30,
  hrTachy: 100, // over 100 for ≥ 2 min continuous → amber
  hrTachyMin: 2,
  hrVeryHigh: 120, // over 120 for ≥ 30 s continuous → red
  hrVeryHighSec: 30,
  badSignalWarnPct: 20,
}
const T = THRESHOLDS

// ---------- zones (live tiles, chart colours) ----------

export interface Zone {
  tone: Tone
  label: string
  explain: string
}

/** Plain-language SpO2 zones: green ≥95, amber 90–94, orange-red 88–89, deep red <88. */
export function spo2Zone(v: number | null | undefined): Zone {
  if (v == null) return { tone: 'none', label: 'No reading', explain: 'Waiting for a steady signal from the finger sensor.' }
  if (v >= 95) return { tone: 'good', label: 'Normal', explain: '95–100% is the normal range for most healthy people.' }
  if (v >= 90) return { tone: 'warn', label: 'A bit low', explain: '90–94% is a little below normal. Short dips during sleep are common.' }
  if (v >= 88) return { tone: 'bad', label: 'Low', explain: '88–89% is low. If it stays this low, or you feel unwell, contact a doctor.' }
  return { tone: 'critical', label: 'Very low', explain: 'Below 88% is very low. If it stays this low or you are short of breath, confused or have chest pain, get medical help now.' }
}

export function pulseZone(v: number | null | undefined): Zone {
  if (v == null) return { tone: 'none', label: 'No reading', explain: 'Pulse appears once the sensor finds your heartbeat.' }
  if (v < 40) return { tone: 'bad', label: 'Very slow', explain: 'Under 40 bpm is unusually slow unless you are a trained athlete.' }
  if (v < 50) return { tone: 'warn', label: 'Slow', explain: '40–50 bpm can be normal during deep sleep or for fit people.' }
  if (v <= 100) return { tone: 'good', label: 'Normal', explain: '50–100 bpm is a normal resting heart rate.' }
  if (v <= 120) return { tone: 'warn', label: 'Fast', explain: 'Over 100 bpm at rest is faster than usual (activity, stress, caffeine, illness).' }
  return { tone: 'bad', label: 'Very fast', explain: 'Over 120 bpm at rest is high. Sit down, rest, and recheck.' }
}

// ---------- data cleaning ----------

export interface SeriesLike {
  start: number
  intervalSec: number
  spo2: (number | null)[]
  pulse: (number | null)[]
}

const inRange = (v: number | null | undefined, [lo, hi]: readonly [number, number]) =>
  v != null && Number.isFinite(v) && v >= lo && v <= hi ? v : null
export const validSpo2 = (v: number | null | undefined) => inRange(v, T.spo2Valid)
export const validPulse = (v: number | null | undefined) => inRange(v, T.pulseValid)
export const cleanSpo2 = (a: (number | null)[]) => a.map(validSpo2)
export const cleanPulse = (a: (number | null)[]) => a.map(validPulse)

const sustainSamples = (dt: number) => Math.max(2, Math.ceil(T.sustainSec / dt))
const bridgeSamples = (dt: number) => Math.max(1, Math.round(T.bridgeSec / dt))

// ---------- building blocks ----------

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)

/** Lowest/highest value held for at least `k` consecutive valid samples. */
export function sustainedExtreme(v: (number | null)[], k: number, kind: 'min' | 'max', from = 0, to = v.length): { value: number | null; idx: number | null } {
  let best: number | null = null
  let bestIdx: number | null = null
  for (let i = from; i + k <= to; i++) {
    let ext: number | null = null
    let worstIdx = i
    let ok = true
    for (let j = i; j < i + k; j++) {
      const x = v[j]
      if (x == null) {
        ok = false
        break
      }
      // The sustained level of the window is its *least* extreme sample.
      if (ext == null || (kind === 'min' ? x > ext : x < ext)) ext = x
      if (kind === 'min' ? x < v[worstIdx]! : x > v[worstIdx]!) worstIdx = j
    }
    if (!ok || ext == null) continue
    if (best == null || (kind === 'min' ? ext < best : ext > best)) {
      best = ext
      bestIdx = worstIdx
    }
  }
  return { value: best, idx: bestIdx }
}

export interface Episode {
  startIdx: number
  endIdx: number
  /** Unix ms. */
  start: number
  end: number
  durationSec: number
  nadir: number
  nadirAt: number
}

/**
 * Runs of samples matching `test`, bridging short gaps, keeping runs with at least `minSamples` matching samples.
 * Invalid (null) samples never match.
 */
export function findEpisodes(values: (number | null)[], start: number, dt: number, test: (v: number) => boolean, minSamples = 1, bridge = 0, kind: 'min' | 'max' = 'min'): Episode[] {
  const out: Episode[] = []
  let s = -1
  let e = -1
  let count = 0
  const flush = () => {
    if (s < 0 || count < minSamples) return
    let ext = sustainedExtreme(values, Math.min(minSamples, 2), kind, s, e + 1)
    if (ext.value == null) {
      let idx = s
      for (let i = s; i <= e; i++) {
        const v = values[i]
        if (v != null && test(v) && (values[idx] == null || (kind === 'min' ? v < values[idx]! : v > values[idx]!))) idx = i
      }
      ext = { value: values[idx], idx }
    }
    out.push({
      startIdx: s,
      endIdx: e,
      start: start + s * dt * 1000,
      end: start + (e + 1) * dt * 1000,
      durationSec: (e - s + 1) * dt,
      nadir: ext.value!,
      nadirAt: start + ext.idx! * dt * 1000,
    })
  }
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v == null || !test(v)) continue
    if (s >= 0 && i - e - 1 <= bridge) {
      e = i
      count++
    } else {
      flush()
      s = e = i
      count = 1
    }
  }
  flush()
  return out
}

export interface Drop {
  startIdx: number
  endIdx: number
  nadir: number
  nadirIdx: number
}

/**
 * Desaturation events (for the oxygen desaturation index, ODI):
 * SpO2 falls ≥ `threshold` points below the recent baseline (median of the previous 2 minutes of
 * non-event readings) for at least 10 seconds. Invalid samples end an event and are skipped.
 */
export function findDrops(s: SeriesLike, threshold = 3, minSec = T.desatMinSec): Drop[] {
  const spo2 = cleanSpo2(s.spo2)
  const n = spo2.length
  const win = Math.max(3, Math.round(T.baselineSec / s.intervalSec))
  const minLen = Math.max(1, Math.ceil(minSec / s.intervalSec))
  const drops: Drop[] = []
  const hist: number[] = []
  let inDrop = false
  let start = 0
  let nadir = 101
  let nadirIdx = 0
  let baseline = 0
  for (let i = 0; i < n; i++) {
    const v = spo2[i]
    if (v == null) {
      // Signal lost mid-event: drop it (likely movement artefact rather than a real desaturation).
      inDrop = false
      continue
    }
    if (!inDrop) {
      if (hist.length >= Math.min(win, 8)) {
        const sorted = [...hist].sort((a, b) => a - b)
        baseline = sorted[Math.floor(sorted.length / 2)]
        if (v <= baseline - threshold) {
          inDrop = true
          start = i
          nadir = v
          nadirIdx = i
        }
      }
      if (!inDrop) {
        hist.push(v)
        if (hist.length > win) hist.shift()
      }
    } else {
      if (v < nadir) {
        nadir = v
        nadirIdx = i
      }
      if (v >= baseline - 1) {
        if (i - start >= minLen) drops.push({ startIdx: start, endIdx: i, nadir, nadirIdx })
        inDrop = false
        hist.push(v)
        if (hist.length > win) hist.shift()
      }
    }
  }
  if (inDrop && n - start >= minLen) drops.push({ startIdx: start, endIdx: n - 1, nadir, nadirIdx })
  return drops
}

// ---------- per-night statistics ----------

export type Rating = 'good' | 'fair' | 'low' | 'very-low'
export const ratingForLevel: Record<Level, Rating> = { 0: 'good', 1: 'fair', 2: 'low', 3: 'very-low' }
export const ratingText: Record<Rating, string> = { good: 'Looks normal', fair: 'Worth watching', low: 'Low oxygen', 'very-low': 'Very low oxygen' }

export interface Finding {
  key: string
  /** null = informational only (never changes the rating). */
  level: Level | null
  title: string
  text: string
}

export interface SessionStats {
  version: number
  durationSec: number
  validSec: number
  badSignalSec: number
  pctBadSignal: number
  avgSpo2: number | null
  /** Nadir: lowest SpO2 held for ≥ ~8 s. */
  minSpo2: number | null
  minSpo2At: number | null
  timeNormalSec: number // ≥95
  timeBitLowSec: number // 90–94
  timeLowSec: number // 88–89
  timeVeryLowSec: number // <88
  timeBelow90Sec: number
  timeBelow88Sec: number
  timeBelow85Sec: number
  timeBelow80Sec: number
  pctBelow90: number
  pctBelow88: number
  /** 3% desaturations (count and per hour of valid recording = ODI-3). */
  drops: number
  dropsPerHour: number
  drops4: number
  odi4: number
  episodes: Episode[]
  episodesBelow90: number
  episodesBelow88: number
  longestBelow90Sec: number
  longestBelow90At: number | null
  longestBelow88Sec: number
  avgPulse: number | null
  minPulse: number | null
  minPulseAt: number | null
  maxPulse: number | null
  maxPulseAt: number | null
  timePulseBelow50Sec: number
  timePulseBelow40Sec: number
  timePulseAbove100Sec: number
  timePulseAbove120Sec: number
  longestPulseBelow50Sec: number
  longestPulseBelow40Sec: number
  longestPulseAbove100Sec: number
  longestPulseAbove120Sec: number
  level: Level
  rating: Rating
  findings: Finding[]
}

export const STATS_VERSION = 2

const longest = (eps: Episode[]) => eps.reduce((m, e) => (e.durationSec > m.durationSec ? e : m), { durationSec: 0, start: 0 } as Pick<Episode, 'durationSec' | 'start'>)

export function computeStats(s: SeriesLike): SessionStats {
  const dt = s.intervalSec
  const spo2 = cleanSpo2(s.spo2)
  const pulse = cleanPulse(s.pulse)
  const n = spo2.length
  const valid = spo2.filter((v): v is number => v != null)
  const pulses = pulse.filter((v): v is number => v != null)
  const k = sustainSamples(dt)
  const bridge = bridgeSamples(dt)

  let z95 = 0, z90 = 0, z88 = 0, zLow = 0, b85 = 0, b80 = 0
  for (const v of valid) {
    if (v >= 95) z95++
    else if (v >= 90) z90++
    else if (v >= 88) z88++
    else zLow++
    if (v < 85) b85++
    if (v < 80) b80++
  }
  let p50 = 0, p40 = 0, p100 = 0, p120 = 0
  for (const v of pulses) {
    if (v < 50) p50++
    if (v < 40) p40++
    if (v > 100) p100++
    if (v > 120) p120++
  }
  const validSec = valid.length * dt
  const durationSec = n * dt
  const hours = validSec / 3600
  const nadir = sustainedExtreme(spo2, k, 'min')
  const minP = sustainedExtreme(pulse, Math.max(3, Math.ceil(10 / dt)), 'min')
  const maxP = sustainedExtreme(pulse, Math.max(3, Math.ceil(10 / dt)), 'max')
  const ep90 = findEpisodes(spo2, s.start, dt, (v) => v < 90, k, bridge)
  const ep88 = findEpisodes(spo2, s.start, dt, (v) => v < 88, k, bridge)
  const hr = (test: (v: number) => boolean, kind: 'min' | 'max') => longest(findEpisodes(pulse, s.start, dt, test, 1, bridge, kind)).durationSec
  const d3 = findDrops(s, 3)
  const d4 = findDrops(s, 4)
  const l90 = longest(ep90)

  const st: Omit<SessionStats, 'level' | 'rating' | 'findings'> = {
    version: STATS_VERSION,
    durationSec,
    validSec,
    badSignalSec: durationSec - validSec,
    pctBadSignal: durationSec ? ((durationSec - validSec) / durationSec) * 100 : 0,
    avgSpo2: mean(valid),
    minSpo2: nadir.value ?? (valid.length ? Math.min(...valid) : null),
    minSpo2At: nadir.idx != null ? s.start + nadir.idx * dt * 1000 : null,
    timeNormalSec: z95 * dt,
    timeBitLowSec: z90 * dt,
    timeLowSec: z88 * dt,
    timeVeryLowSec: zLow * dt,
    timeBelow90Sec: (z88 + zLow) * dt,
    timeBelow88Sec: zLow * dt,
    timeBelow85Sec: b85 * dt,
    timeBelow80Sec: b80 * dt,
    pctBelow90: validSec ? (((z88 + zLow) * dt) / validSec) * 100 : 0,
    pctBelow88: validSec ? ((zLow * dt) / validSec) * 100 : 0,
    drops: d3.length,
    dropsPerHour: hours > 0 ? d3.length / hours : 0,
    drops4: d4.length,
    odi4: hours > 0 ? d4.length / hours : 0,
    episodes: ep90,
    episodesBelow90: ep90.length,
    episodesBelow88: ep88.length,
    longestBelow90Sec: l90.durationSec,
    longestBelow90At: l90.durationSec ? l90.start : null,
    longestBelow88Sec: longest(ep88).durationSec,
    avgPulse: mean(pulses),
    minPulse: minP.value,
    minPulseAt: minP.idx != null ? s.start + minP.idx * dt * 1000 : null,
    maxPulse: maxP.value,
    maxPulseAt: maxP.idx != null ? s.start + maxP.idx * dt * 1000 : null,
    timePulseBelow50Sec: p50 * dt,
    timePulseBelow40Sec: p40 * dt,
    timePulseAbove100Sec: p100 * dt,
    timePulseAbove120Sec: p120 * dt,
    longestPulseBelow50Sec: hr((v) => v < 50, 'min'),
    longestPulseBelow40Sec: hr((v) => v < 40, 'min'),
    longestPulseAbove100Sec: hr((v) => v > 100, 'max'),
    longestPulseAbove120Sec: hr((v) => v > 120, 'max'),
  }
  const findings = assess(st)
  const level = findings.reduce<Level>((m, f) => (f.level != null && f.level > m ? f.level : m), 0)
  return { ...st, findings, level, rating: ratingForLevel[level] }
}

// ---------- clinical-style assessment ----------

export function odiBand(odi: number): { level: Level; label: 'normal' | 'mild' | 'moderate' | 'severe' } {
  const [a, b, c] = T.odiBands
  if (odi < a) return { level: 0, label: 'normal' }
  if (odi < b) return { level: 1, label: 'mild' }
  if (odi < c) return { level: 2, label: 'moderate' }
  return { level: 3, label: 'severe' }
}

const max = (...l: Level[]): Level => l.reduce((m, x) => (x > m ? x : m), 0 as Level)
const pct = (x: number) => (x > 0 && x < 0.1 ? '<0.1' : x.toFixed(1))
const at = (ms: number | null) => (ms ? ` at ${formatClock(ms)}` : '')

/** Each criterion becomes a finding; the rating is the worst finding's level. */
export function assess(st: Omit<SessionStats, 'level' | 'rating' | 'findings'>): Finding[] {
  const f: Finding[] = []
  const min = st.timeBelow90Sec / 60

  if (st.validSec === 0) {
    return [{ key: 'nodata', level: null, title: 'No usable readings', text: 'The sensor never gave a reliable signal during this recording, so nothing can be summarised.' }]
  }

  // Nadir
  if (st.minSpo2 != null) {
    const n = st.minSpo2
    if (n < T.nadirVeryLow) {
      f.push({ key: 'nadir', level: 3, title: `Oxygen fell to ${n}%`, text: `Your lowest steady oxygen reading was ${n}%${at(st.minSpo2At)}. That is far below the normal range of 95–100%. Readings under 85% are a real concern — please discuss this night with a doctor soon.` })
    } else if (n < T.nadirLow) {
      f.push({ key: 'nadir', level: 2, title: `Oxygen dipped to ${n}%`, text: `Your lowest steady oxygen reading was ${n}%${at(st.minSpo2At)}. Below 90% is considered low. Consider discussing this with your doctor, especially if it happens on several nights.` })
    } else {
      f.push({ key: 'nadir', level: 0, title: `Lowest oxygen ${n}%`, text: `Your oxygen stayed at 90% or higher all night (lowest steady reading ${n}%${at(st.minSpo2At)}).` })
    }
  }

  // Time at low levels (T90 / T88 / T85 / T80)
  {
    let level: Level = 0
    if (st.timeBelow90Sec > 0) level = 1
    if (min >= T.t90BadMin || st.pctBelow90 >= T.t90BadPct || st.timeBelow88Sec > 0) level = 2
    if (min >= T.t90CritMin || st.pctBelow90 >= T.t90CritPct || st.timeBelow88Sec / 60 >= T.t88CritMin || st.timeBelow85Sec / 60 >= T.t85CritMin) level = 3
    if (st.timeBelow90Sec > 0) {
      const parts = [`under 90% for ${formatDuration(st.timeBelow90Sec)} (${pct(st.pctBelow90)}% of the night)`]
      if (st.timeBelow88Sec) parts.push(`under 88% for ${formatDuration(st.timeBelow88Sec)}`)
      if (st.timeBelow85Sec) parts.push(`under 85% for ${formatDuration(st.timeBelow85Sec)}`)
      if (st.timeBelow80Sec) parts.push(`under 80% for ${formatDuration(st.timeBelow80Sec)}`)
      const extra =
        st.timeBelow88Sec / 60 >= T.t88CritMin
          ? ' Doctors use about 5 minutes at or below 88% overnight as one of the signs that someone may need oxygen or further tests.'
          : level >= 2
            ? ' Time spent under 90% is one of the main numbers a doctor will look at.'
            : ''
      f.push({ key: 'time-low', level, title: level >= 2 ? 'Time spent at low oxygen' : 'Brief dips under 90%', text: `Oxygen was ${parts.join(', ')}.${extra}` })
    } else {
      f.push({ key: 'time-low', level: 0, title: 'Never below 90%', text: 'Oxygen did not go under 90% at any point.' })
    }
  }

  // Longest continuous episode
  if (st.longestBelow90Sec > 0) {
    const m = st.longestBelow90Sec / 60
    const level: Level = m >= T.longest90CritMin ? 3 : m >= T.longest90BadMin ? 2 : 1
    const e88 = st.longestBelow88Sec ? ` Longest stretch under 88%: ${formatDuration(st.longestBelow88Sec)}.` : ''
    f.push({
      key: 'episodes',
      level,
      title: `${st.episodesBelow90} episode${st.episodesBelow90 === 1 ? '' : 's'} under 90%`,
      text: `The longest continuous stretch under 90% lasted ${formatDuration(st.longestBelow90Sec)}${at(st.longestBelow90At)}.${e88} See “Notable events” below for each one.`,
    })
  }

  // ODI
  {
    const b3 = odiBand(st.dropsPerHour)
    const b4 = odiBand(st.odi4)
    const level = max(b3.level, b4.level)
    const title = { normal: 'Few oxygen drops', mild: 'Mild number of oxygen drops', moderate: 'Moderate number of oxygen drops', severe: 'Severe number of oxygen drops' }[level === b3.level ? b3.label : b4.label]
    f.push({
      key: 'odi',
      level,
      title,
      text: `${st.drops} drops of 3 points or more (ODI-3 ${st.dropsPerHour.toFixed(1)} per hour, ${b3.label}) and ${st.drops4} of 4 points or more (ODI-4 ${st.odi4.toFixed(1)} per hour, ${b4.label}). Usual bands: under 5 per hour normal, 5–15 mild, 15–30 moderate, over 30 severe. Frequent drops can be a sign of breathing pauses (sleep apnoea).`,
    })
  }

  // Average SpO2
  if (st.avgSpo2 != null) {
    const a = st.avgSpo2
    const level: Level = a < T.avgCrit ? 3 : a < T.avgBad ? 2 : a < T.avgWarn ? 1 : 0
    const text =
      level === 0
        ? `Your average oxygen was ${a.toFixed(1)}%, within the usual overnight range (about 94–98%).`
        : `Your average oxygen was ${a.toFixed(1)}%, lower than the usual overnight range (about 94–98%).`
    f.push({ key: 'avg', level, title: `Average oxygen ${a.toFixed(0)}%`, text })
  }

  // Heart rate
  if (st.avgPulse != null) {
    const range = st.minPulse != null && st.maxPulse != null ? ` (lowest ${st.minPulse}${at(st.minPulseAt)}, highest ${st.maxPulse}${at(st.maxPulseAt)})` : ''
    const base = `Your pulse averaged ${Math.round(st.avgPulse)} bpm${range}.`
    const veryLow = st.longestPulseBelow40Sec >= T.hrVeryLowSec
    const low = st.avgPulse < T.hrBradyAvg || st.longestPulseBelow50Sec / 60 >= T.hrBradyLongestMin
    const veryHigh = st.longestPulseAbove120Sec >= T.hrVeryHighSec
    const high = st.longestPulseAbove100Sec / 60 >= T.hrTachyMin
    if (veryLow || low) {
      f.push({
        key: 'hr-low',
        level: veryLow ? 2 : 1,
        title: veryLow ? 'Heart rate fell below 40' : 'Low heart rate',
        text: `${base} It was under 50 bpm for ${formatDuration(st.timePulseBelow50Sec)}${st.timePulseBelow40Sec ? ` and under 40 bpm for ${formatDuration(st.timePulseBelow40Sec)}` : ''}. A slow pulse during sleep can be normal (for example if you are fit or take beta-blockers), but mention it to your doctor${veryLow ? ' — especially under 40 —' : ''} if you also have dizziness, fainting or unusual tiredness.`,
      })
    }
    if (veryHigh || high) {
      f.push({
        key: 'hr-high',
        level: veryHigh ? 2 : 1,
        title: veryHigh ? 'Heart rate over 120' : 'Fast heart rate',
        text: `${base} It was over 100 bpm for ${formatDuration(st.timePulseAbove100Sec)}${st.timePulseAbove120Sec ? ` and over 120 bpm for ${formatDuration(st.timePulseAbove120Sec)}` : ''}. A fast resting pulse during sleep is unusual; mention it to your doctor.`,
      })
    }
    if (!veryLow && !low && !veryHigh && !high) {
      f.push({ key: 'hr', level: 0, title: 'Heart rate in a typical range', text: `${base} That is a typical range for sleep.` })
    }
  }

  // Data quality (never changes the rating, never hides anything above)
  if (st.badSignalSec > 60) {
    const strong = st.pctBadSignal >= T.badSignalWarnPct
    f.push({
      key: 'signal',
      level: null,
      title: strong ? 'A lot of the night had no reliable signal' : 'Some gaps in the signal',
      text: `About ${formatDuration(st.badSignalSec)} (${pct(st.pctBadSignal)}% of the recording) had no reliable reading — the sensor moved or came off. Those parts are left out of every number above${strong ? ', so the summary may miss events' : ''}.`,
    })
  }
  if (st.validSec < 3600) {
    f.push({ key: 'short', level: null, title: 'Short recording', text: `Only ${formatDuration(st.validSec)} of good readings, so per-hour numbers (ODI) are less reliable. Low readings are still flagged.` })
  }

  return f.sort((a, b) => (b.level ?? -1) - (a.level ?? -1))
}

/** Short warning text for banners and history cards (null when nothing reaches red). */
export function warningSummary(st: SessionStats): { level: Level; headline: string; facts: string[]; advice: string } | null {
  if (st.level < 2) return null
  const lowO2 = st.minSpo2 != null && st.minSpo2 < T.nadirLow
  const headline = lowO2 ? (st.level === 3 ? 'Very low oxygen detected' : 'Low oxygen detected') : st.findings.find((x) => x.level === st.level)!.title
  const facts: string[] = []
  if (st.minSpo2 != null && st.minSpo2 < T.nadirLow) facts.push(`Lowest ${st.minSpo2}%${at(st.minSpo2At)}`)
  if (st.timeBelow90Sec) facts.push(`${formatDuration(st.timeBelow90Sec)} under 90%`)
  if (st.timeBelow88Sec) facts.push(`${formatDuration(st.timeBelow88Sec)} under 88%`)
  if (odiBand(st.dropsPerHour).level >= 1) facts.push(`${st.dropsPerHour.toFixed(1)} drops/hour`)
  if (st.longestPulseBelow40Sec >= T.hrVeryLowSec) facts.push(`pulse under 40`)
  if (st.longestPulseAbove120Sec >= T.hrVeryHighSec) facts.push(`pulse over 120`)
  const advice =
    st.level === 3
      ? 'Oxygen this low is a concern. Please share this night with your doctor soon (use Export CSV). If you are short of breath, have chest pain, confusion or bluish lips, call 911.'
      : 'This is below the normal range. Consider discussing this night with your doctor — especially if it happens on several nights, or you snore, wake up gasping, have morning headaches or feel very sleepy during the day.'
  return { level: st.level, headline, facts, advice }
}

// ---------- formatting ----------

export function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} sec`
  const m = Math.round(sec / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm ? `${h} h ${mm} min` : `${h} h`
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** Back-compat helper: findings in display order. */
export function insights(_s: SeriesLike, st: SessionStats): Finding[] {
  return st.findings
}
