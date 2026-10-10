export type Tone = 'good' | 'warn' | 'bad' | 'none'

export interface Zone {
  tone: Tone
  label: string
  explain: string
}

/** Plain-language SpO2 zones used throughout the app. */
export function spo2Zone(v: number | null | undefined): Zone {
  if (v == null) return { tone: 'none', label: 'No reading', explain: 'Waiting for a steady signal from the finger sensor.' }
  if (v >= 95) return { tone: 'good', label: 'Normal', explain: '95–100% is the normal range for most healthy people.' }
  if (v >= 90) return { tone: 'warn', label: 'A bit low', explain: '90–94% is a little below normal. Short dips during sleep are common.' }
  return { tone: 'bad', label: 'Low', explain: 'Below 90% is low. If this lasts or you feel unwell, contact a doctor.' }
}

export function pulseZone(v: number | null | undefined): Zone {
  if (v == null) return { tone: 'none', label: 'No reading', explain: 'Pulse appears once the sensor finds your heartbeat.' }
  if (v < 40) return { tone: 'bad', label: 'Very slow', explain: 'Under 40 bpm is unusually slow unless you are a trained athlete.' }
  if (v < 50) return { tone: 'warn', label: 'Slow', explain: '40–50 bpm can be normal during deep sleep or for fit people.' }
  if (v <= 100) return { tone: 'good', label: 'Normal', explain: '50–100 bpm is a normal resting heart rate.' }
  if (v <= 120) return { tone: 'warn', label: 'Fast', explain: 'Over 100 bpm at rest is faster than usual (activity, stress, caffeine, illness).' }
  return { tone: 'bad', label: 'Very fast', explain: 'Over 120 bpm at rest is high. Sit down, rest, and recheck.' }
}

export interface Drop {
  startIdx: number
  endIdx: number
  nadir: number
  nadirIdx: number
}

export interface SessionStats {
  durationSec: number
  validSec: number
  avgSpo2: number | null
  minSpo2: number | null
  minSpo2At: number | null
  timeNormalSec: number
  timeBitLowSec: number
  timeBelow90Sec: number
  pctBelow90: number
  drops: number
  dropsPerHour: number
  episodesBelow90: number
  avgPulse: number | null
  minPulse: number | null
  maxPulse: number | null
  rating: 'good' | 'fair' | 'attention'
}

export interface SeriesLike {
  start: number
  intervalSec: number
  spo2: (number | null)[]
  pulse: (number | null)[]
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)

/** Lowest/highest value held for at least `k` consecutive valid samples (filters single-sample glitches). */
function sustainedExtreme(v: (number | null)[], k: number, kind: 'min' | 'max'): { value: number | null; idx: number | null } {
  let best: number | null = null
  let bestIdx: number | null = null
  for (let i = 0; i + k <= v.length; i++) {
    let ext: number | null = null
    let ok = true
    for (let j = i; j < i + k; j++) {
      const x = v[j]
      if (x == null) {
        ok = false
        break
      }
      ext = ext == null ? x : kind === 'min' ? Math.max(ext, x) : Math.min(ext, x)
    }
    if (!ok || ext == null) continue
    if (best == null || (kind === 'min' ? ext < best : ext > best)) {
      best = ext
      bestIdx = i
    }
  }
  return { value: best, idx: bestIdx }
}

/**
 * Oxygen "drops" in the spirit of a 3% oxygen desaturation index (ODI):
 * SpO2 falls ≥3 points below the recent baseline (median of the previous 2 minutes)
 * for at least 10 seconds.
 */
export function findDrops(s: SeriesLike, threshold = 3, minSec = 10): Drop[] {
  const n = s.spo2.length
  const win = Math.max(3, Math.round(120 / s.intervalSec))
  const minLen = Math.max(1, Math.ceil(minSec / s.intervalSec))
  const drops: Drop[] = []
  const hist: number[] = []
  let inDrop = false
  let start = 0
  let nadir = 101
  let nadirIdx = 0
  let baseline = 0
  for (let i = 0; i < n; i++) {
    const v = s.spo2[i]
    if (v == null) {
      if (inDrop) inDrop = false
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

export function computeStats(s: SeriesLike): SessionStats {
  const dt = s.intervalSec
  const valid = s.spo2.filter((v): v is number => v != null)
  const pulses = s.pulse.filter((v): v is number => v != null)
  let normal = 0
  let bitLow = 0
  let low = 0
  let episodes = 0
  let run = 0
  const minRun = Math.max(1, Math.ceil(8 / dt))
  for (const v of s.spo2) {
    if (v == null) {
      run = 0
      continue
    }
    if (v >= 95) normal++
    else if (v >= 90) bitLow++
    else low++
    if (v < 90) {
      run++
      if (run === minRun) episodes++
    } else run = 0
  }
  const validSec = valid.length * dt
  const drops = findDrops(s)
  const minS = sustainedExtreme(s.spo2, 2, 'min')
  const minP = sustainedExtreme(s.pulse, 3, 'min')
  const maxP = sustainedExtreme(s.pulse, 3, 'max')
  const avgSpo2 = mean(valid)
  const pctBelow90 = validSec ? ((low * dt) / validSec) * 100 : 0
  const dropsPerHour = validSec > 0 ? drops.length / (validSec / 3600) : 0
  let rating: SessionStats['rating'] = 'good'
  if (dropsPerHour >= 15 || pctBelow90 >= 5 || (avgSpo2 != null && avgSpo2 < 92)) rating = 'attention'
  else if (dropsPerHour >= 5 || pctBelow90 >= 1 || (minS.value != null && minS.value < 88)) rating = 'fair'
  return {
    durationSec: s.spo2.length * dt,
    validSec,
    avgSpo2,
    minSpo2: minS.value,
    minSpo2At: minS.idx == null ? null : s.start + minS.idx * dt * 1000,
    timeNormalSec: normal * dt,
    timeBitLowSec: bitLow * dt,
    timeBelow90Sec: low * dt,
    pctBelow90,
    drops: drops.length,
    dropsPerHour,
    episodesBelow90: episodes,
    avgPulse: mean(pulses),
    minPulse: minP.value,
    maxPulse: maxP.value,
    rating,
  }
}

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

export interface Insight {
  tone: Tone
  title: string
  text: string
}

export function insights(s: SeriesLike, st: SessionStats): Insight[] {
  const out: Insight[] = []
  if (st.validSec < 600) {
    return [{ tone: 'none', title: 'Too short to judge', text: 'This recording has less than 10 minutes of good readings, so there is not enough to summarise.' }]
  }
  const pctNormal = (st.timeNormalSec / st.validSec) * 100
  if (pctNormal >= 90) {
    out.push({ tone: 'good', title: 'Oxygen looked healthy', text: `Your oxygen was in the normal range (95% or higher) for ${Math.round(pctNormal)}% of the time, averaging ${st.avgSpo2!.toFixed(0)}%.` })
  } else if (pctNormal >= 60) {
    out.push({ tone: 'warn', title: 'Mostly normal, some lower stretches', text: `Oxygen was 95% or higher for ${Math.round(pctNormal)}% of the time and averaged ${st.avgSpo2!.toFixed(0)}%. The rest was mostly in the 90–94% “a bit low” band.` })
  } else {
    out.push({ tone: 'bad', title: 'Oxygen often below normal', text: `Oxygen was 95% or higher for only ${Math.round(pctNormal)}% of the time (average ${st.avgSpo2!.toFixed(0)}%). Worth showing to a doctor, especially if it happens on several nights.` })
  }

  const dph = st.dropsPerHour
  const dropText = `${st.drops} drop${st.drops === 1 ? '' : 's'} of 3 points or more (${dph.toFixed(1)} per hour).`
  if (dph < 5) out.push({ tone: 'good', title: 'Few oxygen drops', text: `${dropText} Fewer than 5 per hour is generally considered normal.` })
  else if (dph < 15) out.push({ tone: 'warn', title: 'Some oxygen drops', text: `${dropText} 5–15 per hour is a mild level; frequent drops can be a sign of breathing pauses during sleep.` })
  else out.push({ tone: 'bad', title: 'Frequent oxygen drops', text: `${dropText} Over 15 per hour is a lot. Consider talking to a doctor about a sleep study.` })

  if (st.timeBelow90Sec === 0) {
    out.push({ tone: 'good', title: 'Never below 90%', text: 'Oxygen did not go under 90% at any point.' })
  } else {
    const at = st.minSpo2At ? ` The lowest steady reading was ${st.minSpo2}% at ${formatClock(st.minSpo2At)}.` : ''
    const tone: Tone = st.pctBelow90 >= 5 ? 'bad' : st.pctBelow90 >= 1 ? 'warn' : 'good'
    out.push({ tone, title: tone === 'good' ? 'Brief dips under 90%' : 'Time under 90%', text: `Oxygen was under 90% for ${formatDuration(st.timeBelow90Sec)} in total (${st.pctBelow90.toFixed(1)}% of the time).${at}` })
  }

  if (st.avgPulse != null) {
    const range = st.minPulse != null && st.maxPulse != null ? `, ranging from ${st.minPulse} to ${st.maxPulse}` : ''
    const tone: Tone = st.avgPulse < 40 || st.avgPulse > 100 ? 'warn' : 'good'
    out.push({ tone, title: 'Heart rate', text: `Your pulse averaged ${Math.round(st.avgPulse)} bpm${range}. ${tone === 'good' ? 'That is a typical range for rest and sleep.' : 'That is outside the usual resting range.'}` })
  }

  const missing = st.durationSec - st.validSec
  if (missing > 300) {
    out.push({ tone: 'none', title: 'Some gaps', text: `About ${formatDuration(missing)} had no reading (sensor moved or came off). Those parts are left out of the numbers.` })
  }
  void s
  return out
}
