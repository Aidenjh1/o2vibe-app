import { formatDuration } from '../lib/analytics'

export function ZoneBar({ normal, bitLow, low }: { normal: number; bitLow: number; low: number }) {
  const total = normal + bitLow + low || 1
  const pct = (v: number) => `${(v / total) * 100}%`
  return (
    <div className="zonebar-wrap">
      <div className="zonebar" role="img" aria-label={`Normal ${formatDuration(normal)}, a bit low ${formatDuration(bitLow)}, low ${formatDuration(low)}`}>
        <span className="z-good" style={{ width: pct(normal) }} />
        <span className="z-warn" style={{ width: pct(bitLow) }} />
        <span className="z-bad" style={{ width: pct(low) }} />
      </div>
      <div className="zonebar-legend">
        <span><i className="dot good" />Normal 95%+ <b>{formatDuration(normal)}</b></span>
        <span><i className="dot warn" />90–94% <b>{formatDuration(bitLow)}</b></span>
        <span><i className="dot bad" />Under 90% <b>{formatDuration(low)}</b></span>
      </div>
    </div>
  )
}
