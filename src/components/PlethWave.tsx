import { useEffect, useRef } from 'react'
import { cssVar } from '../ui/theme'

/** Scrolling pulse waveform. Samples arrive in ~1 s batches; we play them out smoothly. */
export function PlethWave({ samples, active, rateHz = 125 }: { samples: number[]; active: boolean; rateHz?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const queue = useRef<number[]>([])
  const buf = useRef<number[]>([])

  useEffect(() => {
    if (samples.length) queue.current.push(...samples)
    if (queue.current.length > rateHz * 3) queue.current.splice(0, queue.current.length - rateHz * 2)
  }, [samples, rateHz])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const draw = (now: number) => {
      const c = canvas.current
      if (!c) return
      const dpr = window.devicePixelRatio || 1
      const w = c.clientWidth
      const h = c.clientHeight
      if (c.width !== w * dpr) {
        c.width = w * dpr
        c.height = h * dpr
      }
      const ctx = c.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const take = Math.min(queue.current.length, Math.round(((now - last) / 1000) * rateHz))
      if (take > 0) {
        buf.current.push(...queue.current.splice(0, take))
        last = now
      } else if (queue.current.length === 0) last = now
      const maxPts = Math.round(rateHz * 4)
      if (buf.current.length > maxPts) buf.current.splice(0, buf.current.length - maxPts)
      ctx.clearRect(0, 0, w, h)
      ctx.strokeStyle = cssVar('--line')
      ctx.lineWidth = 1
      for (let y = 0.25; y < 1; y += 0.25) {
        ctx.beginPath()
        ctx.moveTo(0, y * h)
        ctx.lineTo(w, y * h)
        ctx.stroke()
      }
      const pts = buf.current
      if (active && pts.length > 1) {
        const grad = ctx.createLinearGradient(0, 0, w, 0)
        grad.addColorStop(0, 'transparent')
        grad.addColorStop(0.25, cssVar('--accent'))
        ctx.strokeStyle = grad
        ctx.lineWidth = 2.5
        ctx.lineJoin = 'round'
        ctx.beginPath()
        const dx = w / (maxPts - 1)
        const off = maxPts - pts.length
        pts.forEach((v, i) => {
          const x = (off + i) * dx
          const y = h - 6 - v * (h - 12)
          if (i) ctx.lineTo(x, y)
          else ctx.moveTo(x, y)
        })
        ctx.stroke()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [active, rateHz])

  return <canvas ref={canvas} className="pleth" aria-label="Pulse waveform" role="img" />
}
