import { describe, expect, it } from 'vitest'
import { O2Client } from './client'
import { FakeO2Device } from '../demo/fakeDevice'
import { simulateNight } from '../demo/generate'
import { parseO2File } from '../lib/viatom/file'
import type { LiveReading } from '../lib/viatom/live'

function night(seed = 1, hours = 1) {
  return simulateNight({ start: new Date(2026, 9, 9, 23, 0, 0), hours, profile: 'mild', seed })
}

describe('O2Client against the simulated device', () => {
  it('reads device info and the file list', async () => {
    const dev = new FakeO2Device([night(1), night(2)])
    const c = new O2Client(dev)
    const info = await c.init()
    expect(info.serial).toBe('DEMO000123')
    expect(info.files).toHaveLength(1) // both nights start at the same time → same file name
  })

  it('downloads a multi-chunk recording byte-for-byte with progress', async () => {
    const n = night(3, 2)
    const dev = new FakeO2Device([n])
    const c = new O2Client(dev)
    const info = await c.refreshInfo()
    const progress: number[] = []
    const bytes = await c.downloadFile(info.files[0], (d) => progress.push(d))
    expect(bytes).toEqual(dev.files.get(info.files[0]))
    expect(progress.length).toBeGreaterThan(5)
    const rec = parseO2File(bytes)
    expect(rec.spo2).toEqual(n.spo2)
    expect(rec.pulse).toEqual(n.pulse)
  })

  it('works with larger notification sizes (big MTU)', async () => {
    const dev = new FakeO2Device([night(4)])
    dev.mtu = 244
    const c = new O2Client(dev)
    const info = await c.refreshInfo()
    const bytes = await c.downloadFile(info.files[0])
    expect(bytes.length).toBe(dev.files.get(info.files[0])!.length)
  })

  it('reports an error status when opening a missing file', async () => {
    const c = new O2Client(new FakeO2Device([night(5)]))
    await expect(c.downloadFile('20000101000000')).rejects.toThrow(/could not open/)
  })

  it('streams live readings with a pleth waveform', async () => {
    const dev = new FakeO2Device([])
    const readings: LiveReading[] = []
    const c = new O2Client(dev, { onLive: (r) => readings.push(r) })
    c.startLive(10)
    await new Promise((r) => setTimeout(r, 120))
    c.stopLive()
    expect(readings.length).toBeGreaterThan(2)
    expect(readings[0].spo2).toBeGreaterThan(85)
    expect(readings[0].pulse).toBeGreaterThan(40)
    expect(readings[0].pleth.length).toBe(125)
  })

  it('times out cleanly and retries when the device ignores a request', async () => {
    const dev = new FakeO2Device([])
    const realWrite = dev.write.bind(dev)
    let dropped = 0
    dev.write = async (b: Uint8Array) => {
      if (dropped < 1) {
        dropped++
        return
      }
      return realWrite(b)
    }
    const c = new O2Client(dev)
    const t0 = Date.now()
    const f = await c.request(0x14, (await import('../lib/viatom/commands')).commands.info(), { timeoutMs: 50, retries: 2 })
    expect(f.code).toBe(0)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45)
  })

  it('reconnects automatically after an unexpected drop', async () => {
    const dev = new FakeO2Device([])
    const states: string[] = []
    const c = new O2Client(dev, { onState: (s) => states.push(s) })
    dev.drop()
    await new Promise((r) => setTimeout(r, 700))
    expect(states).toContain('reconnecting')
    expect(states[states.length - 1]).toBe('connected')
    const info = await c.refreshInfo()
    expect(info.model).toBe('1652')
    c.disconnect()
  })

  it('fails pending requests when the link drops', async () => {
    const dev = new FakeO2Device([])
    dev.latencyMs = 50
    const c = new O2Client(dev)
    const p = c.request(0x14, (await import('../lib/viatom/commands')).commands.info(), { timeoutMs: 1000 })
    setTimeout(() => dev.disconnect(), 10)
    c.disconnect()
    await expect(p).rejects.toThrow()
  })
})
