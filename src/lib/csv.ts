import type { StoredSession } from '../db/sessions'

const pad = (n: number) => String(n).padStart(2, '0')
function localStamp(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function sessionToCsv(s: StoredSession): string {
  const rows = ['time,spo2_percent,pulse_bpm,motion']
  for (let i = 0; i < s.spo2.length; i++) {
    rows.push([localStamp(s.start + i * s.intervalSec * 1000), s.spo2[i] ?? '', s.pulse[i] ?? '', s.motion[i] ?? ''].join(','))
  }
  return rows.join('\n') + '\n'
}

export function sessionsToCsv(list: StoredSession[]): string {
  const rows = [
    'session_start,duration_min,rating,avg_spo2,nadir_spo2,nadir_time,min_below_90,pct_below_90,min_below_88,min_below_85,min_below_80,episodes_below_90,longest_below_90_min,odi3_per_hour,odi4_per_hour,avg_pulse,min_pulse,max_pulse,min_pulse_below_50,min_pulse_below_40,min_pulse_above_100,pct_no_signal',
  ]
  const m = (sec: number) => (sec / 60).toFixed(1)
  for (const s of list) {
    const st = s.stats
    rows.push(
      [
        localStamp(s.start),
        Math.round(st.durationSec / 60),
        st.rating,
        st.avgSpo2?.toFixed(1) ?? '',
        st.minSpo2 ?? '',
        st.minSpo2At ? localStamp(st.minSpo2At) : '',
        m(st.timeBelow90Sec),
        st.pctBelow90.toFixed(2),
        m(st.timeBelow88Sec),
        m(st.timeBelow85Sec),
        m(st.timeBelow80Sec),
        st.episodesBelow90,
        m(st.longestBelow90Sec),
        st.dropsPerHour.toFixed(1),
        st.odi4.toFixed(1),
        st.avgPulse?.toFixed(0) ?? '',
        st.minPulse ?? '',
        st.maxPulse ?? '',
        m(st.timePulseBelow50Sec),
        m(st.timePulseBelow40Sec),
        m(st.timePulseAbove100Sec),
        st.pctBadSignal.toFixed(1),
      ].join(','),
    )
  }
  return rows.join('\n') + '\n'
}

export function downloadText(filename: string, text: string, mime = 'text/csv') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
