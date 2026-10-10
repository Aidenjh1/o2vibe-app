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
  const rows = ['session_start,duration_min,avg_spo2,min_spo2,min_below_90,drops,drops_per_hour,avg_pulse,min_pulse,max_pulse']
  for (const s of list) {
    const st = s.stats
    rows.push(
      [
        localStamp(s.start),
        Math.round(st.durationSec / 60),
        st.avgSpo2?.toFixed(1) ?? '',
        st.minSpo2 ?? '',
        (st.timeBelow90Sec / 60).toFixed(1),
        st.drops,
        st.dropsPerHour.toFixed(1),
        st.avgPulse?.toFixed(0) ?? '',
        st.minPulse ?? '',
        st.maxPulse ?? '',
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
