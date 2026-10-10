import { formatDuration } from '../lib/analytics'

export function ZoneBar({ normal, bitLow, low, veryLow }: { normal: number; bitLow: number; low: number; veryLow: number }) {
  const total = normal + bitLow + low + veryLow || 1
  const pct = (v: number) => `${(v / total) * 100}%`
  return (
    <div className="zonebar-wrap">
      <div className="zonebar" role="img" aria-label={`Normal ${formatDuration(normal)}, 90 to 94 percent ${formatDuration(bitLow)}, 88 to 89 percent ${formatDuration(low)}, under 88 percent ${formatDuration(veryLow)}`}>
        <span className="z-good" style={{ width: pct(normal) }} />
        <span className="z-warn" style={{ width: pct(bitLow) }} />
        <span className="z-low" style={{ width: pct(low), minWidth: low ? 3 : 0 }} />
        <span className="z-crit" style={{ width: pct(veryLow), minWidth: veryLow ? 3 : 0 }} />
      </div>
      <div className="zonebar-legend">
        <span><i className="dot good" />Normal 95%+ <b>{formatDuration(normal)}</b></span>
        <span><i className="dot warn" />90–94% <b>{formatDuration(bitLow)}</b></span>
        <span><i className="dot low" />88–89% <b>{formatDuration(low)}</b></span>
        <span><i className="dot crit" />Under 88% <b>{formatDuration(veryLow)}</b></span>
      </div>
    </div>
  )
}
