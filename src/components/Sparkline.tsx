/** Tiny SVG trend line with the 90% / 95% guide bands, for history cards. */
export function Sparkline({ values, min = 80, max = 100, height = 44 }: { values: (number | null)[]; min?: number; max?: number; height?: number }) {
  const W = 300
  const H = height
  const n = values.length
  const step = Math.max(1, Math.floor(n / 110))
  const pts: string[] = []
  let pen = false
  const y = (v: number) => H - ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * H
  for (let i = 0; i < n; i += step) {
    // Halfway between the bucket mean and minimum: calm overall shape, but dips still show.
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
    if (lo != null) lo = (lo + sum / cnt) / 2
    if (lo == null) {
      pen = false
      continue
    }
    const x = (i / Math.max(1, n - 1)) * W
    pts.push(`${pen ? 'L' : 'M'}${x.toFixed(1)},${y(lo).toFixed(1)}`)
    pen = true
  }
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <rect x="0" y={y(95)} width={W} height={y(min) - y(95)} className="spark-warn" />
      <rect x="0" y={y(90)} width={W} height={y(min) - y(90)} className="spark-bad" />
      <path d={pts.join('')} className="spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
