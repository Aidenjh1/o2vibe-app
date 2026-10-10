import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { StoredSession } from '../db/sessions'
import { cssVar } from '../ui/theme'

type Range = [number, number]

/**
 * Whole-night view: ~buckets points, each with mean SpO2 (line), min SpO2 (lower edge of a shaded band,
 * so short dips stay visible) and mean pulse. Zoomed-in view uses the raw samples.
 */
export function prepare(s: StoredSession, buckets = 0): uPlot.AlignedData {
  const n = s.spo2.length
  const step = buckets > 0 ? Math.max(1, Math.ceil(n / buckets)) : 1
  const xs: number[] = []
  const mean: (number | null)[] = []
  const lo: (number | null)[] = []
  const pr: (number | null)[] = []
  for (let i = 0; i < n; i += step) {
    let min: number | null = null
    let sum = 0
    let cnt = 0
    let psum = 0
    let pcnt = 0
    for (let j = i; j < Math.min(n, i + step); j++) {
      const v = s.spo2[j]
      if (v != null) {
        if (min == null || v < min) min = v
        sum += v
        cnt++
      }
      const p = s.pulse[j]
      if (p != null) {
        psum += p
        pcnt++
      }
    }
    xs.push((s.start + (i + (step - 1) / 2) * s.intervalSec * 1000) / 1000)
    mean.push(cnt ? Math.round((sum / cnt) * 10) / 10 : null)
    lo.push(min)
    pr.push(pcnt ? Math.round(psum / pcnt) : null)
  }
  return [xs, mean, lo, pr]
}

/** Shade the SpO2 zones behind the plot. */
function zonesPlugin(): uPlot.Plugin {
  return {
    hooks: {
      drawClear: (u) => {
        const { ctx, bbox } = u
        const y = (v: number) => u.valToPos(v, 'spo2', true)
        const bands: [number, number, string][] = [
          [95, 101, cssVar('--good-bg')],
          [90, 95, cssVar('--warn-bg')],
          [0, 90, cssVar('--bad-bg')],
        ]
        ctx.save()
        for (const [lo, hi, color] of bands) {
          const top = Math.max(bbox.top, y(hi))
          const bot = Math.min(bbox.top + bbox.height, y(lo))
          if (bot <= top) continue
          ctx.fillStyle = color
          ctx.fillRect(bbox.left, top, bbox.width, bot - top)
        }
        ctx.restore()
      },
    },
  }
}

/** Pinch-to-zoom and one-finger pan for touch screens. */
function touchZoomPlugin(onZoom: () => void): uPlot.Plugin {
  return {
    hooks: {
      init: (u) => {
        const over = u.over
        let start: { dist: number; mid: number; min: number; max: number; x: number } | null = null
        const rect = () => over.getBoundingClientRect()
        const touchesInfo = (e: TouchEvent) => {
          const r = rect()
          const t0 = e.touches[0]
          const t1 = e.touches[1]
          if (!t1) return { dist: 0, mid: t0.clientX - r.left, x: t0.clientX - r.left }
          return { dist: Math.abs(t1.clientX - t0.clientX), mid: (t0.clientX + t1.clientX) / 2 - r.left, x: t0.clientX - r.left }
        }
        over.addEventListener(
          'touchstart',
          (e) => {
            const ti = touchesInfo(e)
            start = { ...ti, min: u.scales.x.min!, max: u.scales.x.max! }
          },
          { passive: true },
        )
        over.addEventListener(
          'touchmove',
          (e) => {
            if (!start) return
            const ti = touchesInfo(e)
            const w = rect().width
            const span = start.max - start.min
            const data = u.data[0]
            const full: Range = [data[0], data[data.length - 1]]
            let min: number
            let max: number
            if (e.touches.length >= 2 && start.dist > 0) {
              e.preventDefault()
              const k = Math.max(0.02, Math.min(1, start.dist / Math.max(10, ti.dist)))
              const newSpan = Math.max(300, Math.min(full[1] - full[0], span * k))
              const anchor = start.min + (start.mid / w) * span
              min = anchor - (ti.mid / w) * newSpan
              max = min + newSpan
            } else {
              if (span >= full[1] - full[0] - 1) return // nothing to pan; let the page scroll
              e.preventDefault()
              const shift = ((start.x - ti.x) / w) * span
              min = start.min + shift
              max = start.max + shift
            }
            if (min < full[0]) [min, max] = [full[0], full[0] + (max - min)]
            if (max > full[1]) [min, max] = [full[1] - (max - min), full[1]]
            u.setScale('x', { min, max })
            onZoom()
          },
          { passive: false },
        )
        over.addEventListener('touchend', () => (start = null), { passive: true })
      },
    },
  }
}

export function SessionChart({ session, theme }: { session: StoredSession; theme: string }) {
  const host = useRef<HTMLDivElement>(null)
  const plot = useRef<uPlot | null>(null)
  const [zoomed, setZoomed] = useState(false)
  const [cursor, setCursor] = useState<{ t: number; spo2: number | null; pulse: number | null } | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const coarse = prepare(session, 360)
    const fine = prepare(session)
    let current: 'coarse' | 'fine' = 'coarse'
    const full: Range = [fine[0][0], fine[0][fine[0].length - 1]]
    const axisColor = cssVar('--muted')
    const grid = { stroke: cssVar('--line'), width: 1 }
    const opts: uPlot.Options = {
      width: el.clientWidth,
      height: 300,
      padding: [8, 4, 0, 0],
      cursor: { drag: { x: true, y: false, setScale: true }, points: { size: 8 } },
      legend: { show: false },
      scales: { x: { time: true }, spo2: { range: [80, 100] }, pr: { range: (_u, lo, hi) => [Math.min(40, Math.floor((lo ?? 50) / 10) * 10), Math.max(110, Math.ceil((hi ?? 100) / 10) * 10)] } },
      axes: [
        { stroke: axisColor, grid, ticks: grid, size: 34, font: '12px system-ui', values: (_u, vals) => vals.map((v) => new Date(v * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) },
        { scale: 'spo2', stroke: cssVar('--spo2'), grid, ticks: grid, size: 46, splits: () => [80, 85, 90, 95, 100], font: '12px system-ui', values: (_u, v) => v.map((x) => x + '%') },
        { scale: 'pr', side: 1, stroke: cssVar('--pulse'), grid: { show: false }, ticks: grid, size: 38, font: '12px system-ui' },
      ],
      series: [
        {},
        { label: 'SpO₂', scale: 'spo2', stroke: cssVar('--spo2'), width: 2, spanGaps: false },
        { label: 'SpO₂ low', scale: 'spo2', stroke: 'transparent', width: 0, spanGaps: false, points: { show: false } },
        { label: 'Pulse', scale: 'pr', stroke: cssVar('--pulse'), width: 1.25, spanGaps: false, alpha: 0.85 },
      ],
      bands: [{ series: [1, 2], fill: cssVar('--spo2-band') }],
      plugins: [zonesPlugin(), touchZoomPlugin(() => setZoomed(true))],
      hooks: {
        setSelect: [() => setZoomed(true)],
        setScale: [
          (u, key) => {
            if (key !== 'x') return
            const span = u.scales.x.max! - u.scales.x.min!
            const want = span < 2.5 * 3600 ? 'fine' : 'coarse'
            if (want !== current) {
              current = want
              const min = u.scales.x.min!
              const max = u.scales.x.max!
              // Swap resolution outside of uPlot's own setScale cycle.
              requestAnimationFrame(() => {
                if (plot.current !== u) return
                u.batch(() => {
                  u.setData(want === 'fine' ? fine : coarse, false)
                  u.setScale('x', { min, max })
                })
              })
            }
            setZoomed(span < full[1] - full[0] - 60)
          },
        ],
        setCursor: [
          (u) => {
            const i = u.cursor.idx
            if (i == null) return setCursor(null)
            setCursor({ t: (u.data[0][i] as number) * 1000, spo2: u.data[1][i] == null ? null : Math.round(u.data[1][i] as number), pulse: u.data[3][i] as number | null })
          },
        ],
      },
    }
    plot.current?.destroy()
    plot.current = new uPlot(opts, coarse, el)
    setZoomed(false)
    const ro = new ResizeObserver(() => plot.current?.setSize({ width: el.clientWidth, height: 300 }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      plot.current?.destroy()
      plot.current = null
    }
  }, [session, theme])

  const zoomBy = (k: number) => {
    const u = plot.current
    if (!u) return
    const d = u.data[0]
    const full: Range = [d[0], d[d.length - 1]]
    const min = u.scales.x.min!
    const max = u.scales.x.max!
    const mid = (min + max) / 2
    const span = Math.max(600, Math.min(full[1] - full[0], (max - min) * k))
    let a = mid - span / 2
    let b = mid + span / 2
    if (a < full[0]) [a, b] = [full[0], full[0] + span]
    if (b > full[1]) [a, b] = [full[1] - span, full[1]]
    u.setScale('x', { min: a, max: b })
    setZoomed(span < full[1] - full[0] - 1)
  }
  const reset = () => {
    const u = plot.current
    if (!u) return
    const d = u.data[0]
    u.setScale('x', { min: d[0], max: d[d.length - 1] })
    setZoomed(false)
  }

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div className="chart-legend">
          <span className="lg spo2"><i />SpO₂ {cursor?.spo2 != null ? <b>{cursor.spo2}%</b> : null}</span>
          <span className="lg pulse"><i />Pulse {cursor?.pulse != null ? <b>{cursor.pulse}</b> : null}</span>
          {cursor ? <span className="lg time">{new Date(cursor.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span> : null}
        </div>
        <div className="chart-tools">
          <button className="chip" onClick={() => zoomBy(0.5)} aria-label="Zoom in">＋</button>
          <button className="chip" onClick={() => zoomBy(2)} aria-label="Zoom out">－</button>
          {zoomed ? <button className="chip" onClick={reset}>Whole night</button> : null}
        </div>
      </div>
      <div ref={host} className="chart" />
      <p className="chart-hint">Pinch or drag across the chart to zoom in. Background colours show the oxygen zones.</p>
    </div>
  )
}
