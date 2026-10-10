import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { StoredSession } from '../db/sessions'
import { cleanPulse, cleanSpo2, formatClock, pulseZone, spo2Zone, type Episode } from '../lib/analytics'
import { cssVar } from '../ui/theme'
import { gradientStops, PULSE_STOPS, resolveColor, SPO2_STOPS, type ZoneStops } from '../ui/zones'

/** Default horizontal density: ~120 px per hour keeps 4-second detail readable on a phone. */
const DEFAULT_PPH = 120
/** Upper bound for zoom (px per hour), also capped so the canvas stays a sane size. */
const MAX_PPH = 2400
const MAX_WIDTH = 12000
const PAD_LEFT = 40

export interface ChartFocus {
  start: number
  end: number
  nonce: number
}

type Key = 'spo2' | 'hr'
interface Readout {
  t: number
  v: number | null
}

/** Vertical gradient tied to the y-scale, so each part of the line takes its zone colour. */
function zoneStroke(stops: ZoneStops) {
  return (u: uPlot) => {
    const sc = u.scales.y
    if (sc.min == null || sc.max == null) return resolveColor(stops[stops.length - 1][1])
    const y0 = u.valToPos(sc.min, 'y', true)
    const y1 = u.valToPos(sc.max, 'y', true)
    const g = u.ctx.createLinearGradient(0, y0, 0, y1)
    for (const s of gradientStops(stops, sc.min, sc.max)) g.addColorStop(s.offset, resolveColor(s.color))
    return g
  }
}

/** Background zone shading + threshold guide lines. */
function zonesPlugin(bands: [number, number, string][], lines: number[]): uPlot.Plugin {
  return {
    hooks: {
      drawClear: (u) => {
        const { ctx, bbox } = u
        const y = (v: number) => u.valToPos(v, 'y', true)
        ctx.save()
        for (const [lo, hi, color] of bands) {
          const top = Math.max(bbox.top, y(hi))
          const bot = Math.min(bbox.top + bbox.height, y(lo))
          if (bot <= top) continue
          ctx.fillStyle = color
          ctx.fillRect(bbox.left, top, bbox.width, bot - top)
        }
        ctx.strokeStyle = cssVar('--line-strong')
        ctx.lineWidth = uPlot.pxRatio
        ctx.setLineDash([4 * uPlot.pxRatio, 4 * uPlot.pxRatio])
        for (const v of lines) {
          const yy = Math.round(y(v)) + 0.5
          if (yy < bbox.top || yy > bbox.top + bbox.height) continue
          ctx.beginPath()
          ctx.moveTo(bbox.left, yy)
          ctx.lineTo(bbox.left + bbox.width, yy)
          ctx.stroke()
        }
        ctx.restore()
      },
    },
  }
}

/** Episode rug, focus highlight and labelled extreme points. */
function markersPlugin(opts: {
  episodes: Episode[]
  points: { t: number; v: number; label: string; color: string }[]
  highlight: { current: [number, number] | null }
}): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const { ctx, bbox } = u
        const px = uPlot.pxRatio
        const x = (ms: number) => u.valToPos(ms / 1000, 'x', true)
        ctx.save()
        const h = opts.highlight.current
        if (h) {
          const x0 = x(h[0])
          const x1 = Math.max(x0 + 2 * px, x(h[1]))
          ctx.fillStyle = cssVar('--focus-bg')
          ctx.fillRect(x0, bbox.top, x1 - x0, bbox.height)
          ctx.strokeStyle = cssVar('--focus')
          ctx.lineWidth = 2 * px
          ctx.strokeRect(x0, bbox.top + px, x1 - x0, bbox.height - 2 * px)
        }
        ctx.fillStyle = resolveColor('var(--z-crit)')
        for (const e of opts.episodes) {
          const x0 = x(e.start)
          ctx.fillRect(x0, bbox.top + bbox.height - 6 * px, Math.max(3 * px, x(e.end) - x0), 6 * px)
        }
        ctx.font = `700 ${12 * px}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        for (const p of opts.points) {
          const cx = x(p.t)
          const cy = u.valToPos(p.v, 'y', true)
          ctx.fillStyle = p.color
          ctx.beginPath()
          ctx.arc(cx, cy, 4.5 * px, 0, Math.PI * 2)
          ctx.fill()
          ctx.lineWidth = 2 * px
          ctx.strokeStyle = cssVar('--surface')
          ctx.stroke()
          const above = cy - bbox.top > 24 * px
          const ty = above ? cy - 10 * px : cy + 20 * px
          ctx.lineWidth = 3 * px
          ctx.strokeText(p.label, cx, ty)
          ctx.fillText(p.label, cx, ty)
        }
        ctx.restore()
      },
    },
  }
}

export function SessionCharts({ session, theme, focus }: { session: StoredSession; theme: string; focus: ChartFocus | null }) {
  const st = session.stats
  const data = useMemo(() => {
    const dt = session.intervalSec
    const xs = session.spo2.map((_, i) => (session.start + i * dt * 1000) / 1000)
    const spo2 = cleanSpo2(session.spo2)
    const pulse = cleanPulse(session.pulse)
    const vs = spo2.filter((v): v is number => v != null)
    const ps = pulse.filter((v): v is number => v != null)
    const lowest = vs.length ? Math.min(...vs) : 90
    const spo2Range: [number, number] = [Math.max(50, Math.min(80, Math.floor((lowest - 3) / 5) * 5)), 100]
    const pMin = ps.length ? Math.min(...ps) : 50
    const pMax = ps.length ? Math.max(...ps) : 100
    const hrRange: [number, number] = [Math.max(20, Math.min(35, Math.floor((pMin - 5) / 5) * 5)), Math.max(110, Math.ceil((pMax + 8) / 10) * 10)]
    return { xs, spo2, pulse, spo2Range, hrRange, hours: Math.max(0.05, (xs.length * dt) / 3600) }
  }, [session])

  const scrollRefs = { spo2: useRef<HTMLDivElement>(null), hr: useRef<HTMLDivElement>(null) }
  const hostRefs = { spo2: useRef<HTMLDivElement>(null), hr: useRef<HTMLDivElement>(null) }
  const bodyRefs = { spo2: useRef<HTMLDivElement>(null), hr: useRef<HTMLDivElement>(null) }
  const screenRef = useRef<HTMLElement>(null)
  const plots = useRef<Partial<Record<Key, uPlot>>>({})
  const pph = useRef(0)
  const highlight = useRef<[number, number] | null>(null)
  const syncing = useRef(false)
  const [labels, setLabels] = useState<Record<Key, { v: number; top: number }[]>>({ spo2: [], hr: [] })
  const [readout, setReadout] = useState<Record<Key, Readout | null>>({ spo2: null, hr: null })
  const [isFit, setIsFit] = useState(false)
  const [fs, setFs] = useState(() => !!document.fullscreenElement)

  const viewport = () => scrollRefs.spo2.current?.clientWidth || 360
  const fitPph = useCallback(() => viewport() / data.hours, [data.hours]) // eslint-disable-line react-hooks/exhaustive-deps
  const maxPph = useCallback(() => Math.max(fitPph(), Math.min(MAX_PPH, MAX_WIDTH / data.hours)), [data.hours, fitPph])
  const widthFor = (p: number) => Math.max(viewport(), Math.round(p * data.hours))

  const layoutLabels = useCallback(() => {
    const next: Record<Key, { v: number; top: number }[]> = { spo2: [], hr: [] }
    for (const key of ['spo2', 'hr'] as Key[]) {
      const u = plots.current[key]
      const body = bodyRefs[key].current
      if (!u || !body) continue
      const off = u.over.getBoundingClientRect().top - body.getBoundingClientRect().top
      const [lo, hi] = key === 'spo2' ? data.spo2Range : data.hrRange
      const ticks = key === 'spo2' ? [100, 95, 90, 88, 85, 80, 75, 70, 60, 50] : [40, 50, 60, 80, 100, 120, 140, 160, 180]
      next[key] = ticks.filter((v) => v >= lo && v <= hi).map((v) => ({ v, top: off + u.valToPos(v, 'y') }))
    }
    setLabels(next)
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Set horizontal density for both charts, optionally keeping a point (fraction of width at viewport x) in place. */
  const applyPph = useCallback(
    (next: number, anchor?: { frac: number; x: number }, after?: () => void) => {
      const prevScroll = scrollRefs.spo2.current
      const a = anchor ?? (prevScroll ? { frac: (prevScroll.scrollLeft + viewport() / 2) / Math.max(1, prevScroll.scrollWidth), x: viewport() / 2 } : { frac: 0, x: 0 })
      pph.current = Math.max(fitPph(), Math.min(maxPph(), next))
      const width = widthFor(pph.current)
      for (const key of ['spo2', 'hr'] as Key[]) {
        const u = plots.current[key]
        const sc = scrollRefs[key].current
        if (u && sc) u.setSize({ width, height: sc.clientHeight })
      }
      setIsFit(pph.current <= fitPph() * 1.02)
      requestAnimationFrame(() => {
        const left = a.frac * width - a.x
        syncing.current = true
        for (const key of ['spo2', 'hr'] as Key[]) {
          const sc = scrollRefs[key].current
          if (sc) sc.scrollLeft = left
        }
        requestAnimationFrame(() => (syncing.current = false))
        layoutLabels()
        after?.()
      })
    },
    [fitPph, maxPph, layoutLabels], // eslint-disable-line react-hooks/exhaustive-deps
  )

  /** Zoom so that [t0, t1] (ms) fills the screen, centred. */
  const focusRange = useCallback(
    (t0: number, t1: number) => {
      const span = Math.max(15 * 60 * 1000, (t1 - t0) * 2)
      const target = viewport() / (span / 3600000)
      const u = plots.current.spo2
      const center = (t0 + t1) / 2
      applyPph(target, { frac: 0, x: 0 }, () => {
        if (!u) return
        const cx = u.valToPos(center / 1000, 'x') + u.bbox.left / uPlot.pxRatio
        const left = cx - viewport() / 2
        syncing.current = true
        for (const key of ['spo2', 'hr'] as Key[]) {
          const sc = scrollRefs[key].current
          if (sc) sc.scrollLeft = left
        }
        requestAnimationFrame(() => (syncing.current = false))
      })
    },
    [applyPph], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Create both charts.
  useEffect(() => {
    const cursorKey = 'o2-' + session.id
    const grid = { stroke: cssVar('--line'), width: 1 }
    const xAxis: uPlot.Axis = {
      stroke: cssVar('--muted'),
      grid,
      ticks: grid,
      size: 30,
      space: 64,
      font: '12px system-ui',
      values: (_u, vals) => vals.map((v) => formatClock(v * 1000)),
    }
    const x0 = data.xs[0]
    const x1 = data.xs[data.xs.length - 1] ?? x0 + 1
    const make = (key: Key): uPlot => {
      const host = hostRefs[key].current!
      const sc = scrollRefs[key].current!
      const isSpo2 = key === 'spo2'
      const crit = cssVar('--crit-bg')
      const warn = cssVar('--warn-bg')
      const opts: uPlot.Options = {
        width: widthFor(pph.current || DEFAULT_PPH),
        height: Math.max(160, sc.clientHeight),
        padding: [12, 14, 0, PAD_LEFT],
        cursor: {
          sync: { key: cursorKey },
          drag: { x: true, y: false, setScale: false },
          points: { size: 8 },
          y: false,
        },
        legend: { show: false },
        scales: { x: { time: true, range: [x0, x1] }, y: { range: isSpo2 ? data.spo2Range : data.hrRange } },
        axes: [xAxis, { show: false }],
        series: [
          {},
          {
            label: isSpo2 ? 'SpO₂' : 'Pulse',
            scale: 'y',
            stroke: zoneStroke(isSpo2 ? SPO2_STOPS : PULSE_STOPS),
            width: isSpo2 ? 2.25 : 1.75,
            spanGaps: false,
            points: { show: false },
          },
        ],
        plugins: [
          isSpo2
            ? zonesPlugin([[95, 101, cssVar('--good-bg')], [90, 95, warn], [88, 90, cssVar('--low-bg')], [0, 88, crit]], [95, 90, 88])
            : zonesPlugin([[0, 40, crit], [40, 50, warn], [100, 120, warn], [120, 400, crit]], [50, 100]),
          markersPlugin({
            episodes: isSpo2 ? st.episodes : [],
            highlight,
            points: isSpo2
              ? st.minSpo2 != null && st.minSpo2At
                ? [{ t: st.minSpo2At, v: st.minSpo2, label: `Lowest ${st.minSpo2}%`, color: resolveColor(st.minSpo2 < 88 ? 'var(--z-crit)' : st.minSpo2 < 90 ? 'var(--z-low)' : 'var(--z-warn)') }]
                : []
              : [
                  ...(st.minPulse != null && st.minPulseAt ? [{ t: st.minPulseAt, v: st.minPulse, label: `${st.minPulse}`, color: resolveColor(st.minPulse < 40 ? 'var(--z-crit)' : st.minPulse < 50 ? 'var(--z-warn)' : 'var(--hr-ok)') }] : []),
                  ...(st.maxPulse != null && st.maxPulseAt ? [{ t: st.maxPulseAt, v: st.maxPulse, label: `${st.maxPulse}`, color: resolveColor(st.maxPulse > 120 ? 'var(--z-crit)' : st.maxPulse > 100 ? 'var(--z-warn)' : 'var(--hr-ok)') }] : []),
                ],
          }),
        ],
        hooks: {
          setCursor: [
            (u) => {
              const i = u.cursor.idx
              setReadout((r) => ({ ...r, [key]: i == null ? null : { t: (u.data[0][i] as number) * 1000, v: (u.data[1][i] as number | null) ?? null } }))
            },
          ],
          setSelect: [
            (u) => {
              if (u.select.width > 8) {
                const a = u.posToVal(u.select.left, 'x') * 1000
                const b = u.posToVal(u.select.left + u.select.width, 'x') * 1000
                highlight.current = null
                focusRange(a, b)
              }
              u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false)
            },
          ],
        },
      }
      return new uPlot(opts, [data.xs, isSpo2 ? data.spo2 : data.pulse], host)
    }
    plots.current.spo2?.destroy()
    plots.current.hr?.destroy()
    if (!pph.current) pph.current = Math.max(fitPph(), Math.min(maxPph(), DEFAULT_PPH))
    plots.current = { spo2: make('spo2'), hr: make('hr') }
    setIsFit(pph.current <= fitPph() * 1.02)
    requestAnimationFrame(layoutLabels)

    const ro = new ResizeObserver(() => {
      const fit = fitPph()
      if (pph.current < fit || isFitRef.current) pph.current = fit
      applyPph(pph.current)
    })
    ro.observe(scrollRefs.spo2.current!)
    ro.observe(scrollRefs.hr.current!)
    return () => {
      ro.disconnect()
      plots.current.spo2?.destroy()
      plots.current.hr?.destroy()
      plots.current = {}
    }
  }, [session, theme, data]) // eslint-disable-line react-hooks/exhaustive-deps

  const isFitRef = useRef(isFit)
  isFitRef.current = isFit

  // Keep the two charts scrolled together.
  useEffect(() => {
    const a = scrollRefs.spo2.current!
    const b = scrollRefs.hr.current!
    const link = (from: HTMLDivElement, to: HTMLDivElement) => () => {
      if (syncing.current) return
      syncing.current = true
      to.scrollLeft = from.scrollLeft
      requestAnimationFrame(() => (syncing.current = false))
    }
    const ab = link(a, b)
    const ba = link(b, a)
    a.addEventListener('scroll', ab, { passive: true })
    b.addEventListener('scroll', ba, { passive: true })
    return () => {
      a.removeEventListener('scroll', ab)
      b.removeEventListener('scroll', ba)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Two-finger pinch on either chart changes the horizontal zoom of both.
  useEffect(() => {
    const els = [scrollRefs.spo2.current!, scrollRefs.hr.current!]
    let start: { d: number; p: number; frac: number; x: number } | null = null
    let pending: number | null = null
    let raf = 0
    const info = (el: HTMLElement, e: TouchEvent) => {
      const r = el.getBoundingClientRect()
      const [t0, t1] = [e.touches[0], e.touches[1]]
      return { d: Math.abs(t1.clientX - t0.clientX) || 1, mid: (t0.clientX + t1.clientX) / 2 - r.left }
    }
    const handlers = els.map((el) => {
      const ts = (e: TouchEvent) => {
        if (e.touches.length !== 2) return
        const i = info(el, e)
        start = { d: i.d, p: pph.current, frac: (el.scrollLeft + i.mid) / el.scrollWidth, x: i.mid }
      }
      const tm = (e: TouchEvent) => {
        if (!start || e.touches.length !== 2) return
        e.preventDefault()
        pending = start.p * (info(el, e).d / start.d)
        if (!raf)
          raf = requestAnimationFrame(() => {
            raf = 0
            if (pending != null && start) applyPph(pending, { frac: start.frac, x: start.x })
          })
      }
      const te = (e: TouchEvent) => {
        if (e.touches.length < 2) start = null
      }
      el.addEventListener('touchstart', ts, { passive: true })
      el.addEventListener('touchmove', tm, { passive: false })
      el.addEventListener('touchend', te, { passive: true })
      return () => {
        el.removeEventListener('touchstart', ts)
        el.removeEventListener('touchmove', tm)
        el.removeEventListener('touchend', te)
      }
    })
    return () => handlers.forEach((h) => h())
  }, [applyPph]) // eslint-disable-line react-hooks/exhaustive-deps

  // Jump to an event chosen from the "Notable events" list.
  useEffect(() => {
    if (!focus) return
    highlight.current = [focus.start, focus.end]
    screenRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    focusRange(focus.start, focus.end)
    plots.current.spo2?.redraw()
    plots.current.hr?.redraw()
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps

  // Full-screen (Fullscreen API + landscape lock where supported).
  useEffect(() => {
    const h = () => setFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        ;(screen.orientation as ScreenOrientation & { unlock?: () => void })?.unlock?.()
        await document.exitFullscreen()
      } else {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
        await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape').catch(() => undefined)
      }
    } catch {
      /* not supported */
    }
  }

  const zoomBy = (k: number) => applyPph(pph.current * k)
  const whole = () => {
    highlight.current = null
    applyPph(fitPph())
    plots.current.spo2?.redraw()
    plots.current.hr?.redraw()
  }
  const fsSupported = typeof document !== 'undefined' && document.fullscreenEnabled

  const tools = (
    <div className="chart-tools">
      <button className="chip" onClick={() => zoomBy(0.5)} aria-label="Zoom out">－</button>
      <button className="chip" onClick={() => zoomBy(2)} aria-label="Zoom in">＋</button>
      {!isFit ? <button className="chip" onClick={whole} aria-label="Show whole night">All</button> : null}
      {fsSupported ? (
        <button className="chip" onClick={toggleFullscreen} aria-label={fs ? 'Exit full screen' : 'Full screen'}>
          {fs ? '✕' : '⛶'}
        </button>
      ) : null}
    </div>
  )

  const head = (key: Key) => {
    const r = readout[key]
    const z = key === 'spo2' ? spo2Zone(r?.v) : pulseZone(r?.v)
    return (
      <div className="chart-head">
        <div className="chart-title">
          <b>{key === 'spo2' ? 'Oxygen (SpO₂)' : 'Heart rate'}</b>
          {r ? (
            <span className={`readout ${z.tone}`}>
              {r.v != null ? `${r.v}${key === 'spo2' ? '%' : ' bpm'}` : 'no signal'} · {formatClock(r.t)}
            </span>
          ) : key === 'spo2' ? (
            st.minSpo2 != null ? <span className={`readout ${spo2Zone(st.minSpo2).tone}`}>Lowest {st.minSpo2}%{st.minSpo2At ? ` at ${formatClock(st.minSpo2At)}` : ''}</span> : null
          ) : st.minPulse != null ? (
            <span className="readout">Range {st.minPulse}–{st.maxPulse} bpm</span>
          ) : null}
        </div>
        {tools}
      </div>
    )
  }

  const body = (key: Key) => (
    <div className="chart-body" ref={bodyRefs[key]}>
      <div className="chart-scroll" ref={scrollRefs[key]}>
        <div ref={hostRefs[key]} />
      </div>
      <div className="y-labels" aria-hidden="true">
        {labels[key].map((l) => (
          <span key={l.v} style={{ top: l.top }} className={key === 'spo2' && l.v === 90 ? 'em' : ''}>
            {l.v}
            {key === 'spo2' ? '%' : ''}
          </span>
        ))}
      </div>
    </div>
  )

  return (
    <div className="charts">
      <section className="chart-screen" ref={screenRef} aria-label="Oxygen chart">
        {head('spo2')}
        {body('spo2')}
        <div className="chart-legend-row">
          <span><i className="sw good" />95%+</span>
          <span><i className="sw warn" />90–94</span>
          <span><i className="sw low" />88–89</span>
          <span><i className="sw crit" />under 88</span>
          <span><i className="sw rug" />episodes under 90%</span>
          <span className="muted">Swipe sideways · pinch to zoom</span>
        </div>
      </section>
      <section className="chart-screen" aria-label="Heart rate chart">
        {head('hr')}
        {body('hr')}
        <div className="chart-legend-row">
          <span><i className="sw pulse" />50–100</span>
          <span><i className="sw warn" />40–49 / 101–120</span>
          <span><i className="sw crit" />under 40 / over 120</span>
          <span className="muted">Scrolls together with the oxygen chart</span>
        </div>
      </section>
    </div>
  )
}
