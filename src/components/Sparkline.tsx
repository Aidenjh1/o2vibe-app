import { useId } from 'react'
import { gradientStops, SPO2_STOPS, type ZoneStops } from '../ui/zones'

/**
 * Tiny SVG trend line whose colour follows the zones (e.g. green ≥95, amber 90–94, orange 88–89, red <88),
 * with optional faint guide bands. Used on history cards and the live view.
 */
export function Sparkline({
  values,
  min = 80,
  max = 100,
  height = 44,
  stops = SPO2_STOPS,
  bands = true,
  mode = 'low',
}: {
  values: (number | null)[]
  min?: number
  max?: number
  height?: number
  stops?: ZoneStops
  bands?: boolean
  /** 'low' keeps dips visible when down-sampling (SpO2); 'mean' for pulse. */
  mode?: 'low' | 'mean'
}) {
  const id = useId().replace(/:/g, '')
  const W = 300
  const H = height
  const n = values.length
  const step = Math.max(1, Math.floor(n / 110))
  const pts: string[] = []
  let pen = false
  const y = (v: number) => H - ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * H
  for (let i = 0; i < n; i += step) {
    let lo: number | null = null
    let sum = 0
    let cnt = 0
    for (let j = i; j < Math.min(n, i + step); j++) {
      const v = values[j]
      if (v == null) continue
      if (lo == null || v < lo) lo = v
      sum += v
      cnt++
    }
    if (lo == null) {
      pen = false
      continue
    }
    // Halfway between the bucket mean and minimum: calm overall shape, but dips still show.
    const v = mode === 'low' ? (lo + sum / cnt) / 2 : sum / cnt
    const x = (i / Math.max(1, n - 1)) * W
    pts.push(`${pen ? 'L' : 'M'}${x.toFixed(1)},${y(v).toFixed(1)}`)
    pen = true
  }
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`g${id}`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={H} y2="0">
          {gradientStops(stops, min, max).map((s, i) => (
            <stop key={i} offset={s.offset} style={{ stopColor: s.color }} />
          ))}
        </linearGradient>
      </defs>
      {bands ? (
        <>
          <rect x="0" y={y(95)} width={W} height={y(min) - y(95)} className="spark-warn" />
          <rect x="0" y={y(90)} width={W} height={y(min) - y(90)} className="spark-bad" />
        </>
      ) : null}
      <path d={pts.join('')} className="spark-line" stroke={`url(#g${id})`} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
