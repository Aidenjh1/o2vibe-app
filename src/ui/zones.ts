/**
 * Colour stops shared by charts and sparklines. Each entry is [lower bound, CSS colour]:
 * values ≥ bound (and below the next bound) use that colour.
 */
export type ZoneStops = ReadonlyArray<readonly [number, string]>

/** SpO2: deep red <88, orange-red 88–89, amber 90–94, green ≥95. */
export const SPO2_STOPS: ZoneStops = [
  [-Infinity, 'var(--z-crit)'],
  [88, 'var(--z-low)'],
  [90, 'var(--z-warn)'],
  [95, 'var(--z-good)'],
]

/** Pulse: deep red <40, amber 40–49, calm blue 50–100, amber 101–120, deep red >120. */
export const PULSE_STOPS: ZoneStops = [
  [-Infinity, 'var(--z-crit)'],
  [40, 'var(--z-warn)'],
  [50, 'var(--hr-ok)'],
  [100.5, 'var(--z-warn)'],
  [120.5, 'var(--z-crit)'],
]

/** Gradient offsets (0 = bottom/min, 1 = top/max) with hard edges at each threshold. */
export function gradientStops(stops: ZoneStops, min: number, max: number): { offset: number; color: string }[] {
  const frac = (v: number) => Math.max(0, Math.min(1, (v - min) / (max - min || 1)))
  const out: { offset: number; color: string }[] = []
  stops.forEach(([t, c], i) => {
    const next = stops[i + 1]
    out.push({ offset: frac(t), color: c }, { offset: next ? frac(next[0]) : 1, color: c })
  })
  return out
}

/** Resolve `var(--x)` for canvas use. */
export function resolveColor(c: string): string {
  const m = /^var\((--[^)]+)\)$/.exec(c)
  return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || '#888' : c
}
