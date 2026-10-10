import { Cmd, DEVICE_LEAD, FRAME_OVERHEAD, HEADER_LEN } from '../lib/viatom/constants'
import { crc8 } from '../lib/viatom/crc'
import { formatDeviceTime } from '../lib/viatom/commands'
import { encodeO2File } from '../lib/viatom/file'
import { O2Error, type Transport } from '../ble/transport'
import { demoNights, mulberry32, plethShape, type SimNight } from './generate'

const pad = (n: number) => String(n).padStart(2, '0')
const fileName = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

export function buildResponse(status: number, block: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(FRAME_OVERHEAD + payload.length)
  out[0] = DEVICE_LEAD
  out[1] = status
  out[2] = ~status & 0xff
  out[3] = block & 0xff
  out[4] = block >> 8
  out[5] = payload.length & 0xff
  out[6] = payload.length >> 8
  out.set(payload, HEADER_LEN)
  out[out.length - 1] = crc8(out, 0, out.length - 1)
  return out
}

/**
 * A software O2 Vibe that speaks the same byte protocol as the real device.
 * Demo mode drives the *real* client code through this, so the whole protocol path is exercised.
 */
export class FakeO2Device implements Transport {
  readonly kind = 'demo' as const
  readonly name = 'O2 Vibe (demo)'
  connected = true
  files = new Map<string, Uint8Array>()
  /** Notification payload size (Chrome on Android usually negotiates a big MTU; real old firmware may use 20). */
  mtu = 20
  /** Optional latency per notification in ms (0 = microtask). */
  latencyMs = 0
  private rx = new Uint8Array(0)
  private dataCb: (b: Uint8Array) => void = () => {}
  private discCb: () => void = () => {}
  private openFile: Uint8Array | null = null
  private clock = new Date()
  private livePhase = 0
  private liveT = 0
  private rnd = mulberry32(42)
  /** Force a status code on the next response (tests). */
  failNext: number | null = null

  constructor(nights: SimNight[] = demoNights()) {
    for (const n of nights) this.files.set(fileName(n.start), encodeO2File(n))
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.connected) throw new O2Error('disconnected', 'Demo device disconnected')
    const m = new Uint8Array(this.rx.length + bytes.length)
    m.set(this.rx)
    m.set(bytes, this.rx.length)
    this.rx = m
    while (this.rx.length >= FRAME_OVERHEAD) {
      const len = this.rx[5] | (this.rx[6] << 8)
      if (this.rx.length < FRAME_OVERHEAD + len) break
      const frame = this.rx.slice(0, FRAME_OVERHEAD + len)
      this.rx = this.rx.slice(FRAME_OVERHEAD + len)
      if (frame[0] !== 0xaa || frame[1] !== (~frame[2] & 0xff) || crc8(frame, 0, frame.length - 1) !== frame[frame.length - 1]) {
        this.rx = new Uint8Array(0)
        return // real devices silently ignore bad frames
      }
      this.handle(frame[1], frame[3] | (frame[4] << 8), frame.slice(HEADER_LEN, frame.length - 1))
    }
  }

  private send(status: number, block: number, payload: Uint8Array) {
    if (this.failNext !== null) {
      status = this.failNext
      this.failNext = null
    }
    const resp = buildResponse(status, block, payload)
    const parts: Uint8Array[] = []
    for (let i = 0; i < resp.length; i += this.mtu) parts.push(resp.slice(i, i + this.mtu))
    let delay = 0
    for (const p of parts) {
      delay += this.latencyMs
      if (this.latencyMs) setTimeout(() => this.connected && this.dataCb(p), delay)
      else queueMicrotask(() => this.connected && this.dataCb(p))
    }
  }

  private handle(cmd: number, block: number, payload: Uint8Array) {
    const ok = (p: Uint8Array = new Uint8Array(0), b = 0) => this.send(0, b, p)
    switch (cmd) {
      case Cmd.PARA_SYNC: {
        const j = JSON.parse(new TextDecoder().decode(payload)) as Record<string, string>
        if (j.SetTIME) this.clock = new Date()
        return ok()
      }
      case Cmd.INFO: {
        const info = {
          Region: 'CE',
          Model: '1652',
          HardwareVer: 'AA',
          SoftwareVer: '1.4.0',
          BootloaderVer: '0.1.0',
          FileVer: '3',
          SN: 'DEMO000123',
          CurTIME: formatDeviceTime(this.clock),
          CurBAT: '82%',
          CurBatState: '0',
          CurOxiThr: '90',
          CurMotor: '50',
          CurMode: '0',
          FileList: [...this.files.keys()].join(',') + ',',
        }
        return ok(new TextEncoder().encode(JSON.stringify(info) + '\0\0\0'))
      }
      case Cmd.FILE_OPEN: {
        const name = new TextDecoder().decode(payload).replace(/\0.*$/, '')
        const f = this.files.get(name)
        if (!f) return this.send(1, 0, new Uint8Array(0))
        this.openFile = f
        return ok(new Uint8Array([f.length & 0xff, (f.length >> 8) & 0xff, (f.length >> 16) & 0xff, f.length >>> 24]))
      }
      case Cmd.FILE_READ: {
        if (!this.openFile) return this.send(1, block, new Uint8Array(0))
        const CH = 512
        return ok(this.openFile.slice(block * CH, block * CH + CH), block)
      }
      case Cmd.FILE_CLOSE:
        this.openFile = null
        return ok()
      case Cmd.RT_WAVE:
        return ok(this.rtWavePayload())
      case Cmd.READ_SENSORS: {
        const p = new Uint8Array(13)
        const { spo2, hr } = this.liveValues()
        p[0] = spo2
        p[1] = hr
        p[7] = 82
        p[9] = 0
        p[10] = 45
        p[11] = 1
        return ok(p)
      }
      default:
        return this.send(1, 0, new Uint8Array(0))
    }
  }

  private liveValues() {
    this.liveT += 1
    const t = this.liveT
    const dip = t % 90 > 60 && t % 90 < 80 ? Math.sin(((t % 90) - 60) / 20 * Math.PI) * 6 : 0
    const spo2 = Math.round(96.5 + Math.sin(t / 23) * 0.8 + (this.rnd() - 0.5) - dip)
    const hr = Math.round(64 + Math.sin(t / 31) * 4 + (this.rnd() - 0.5) * 2 + dip * 0.6)
    return { spo2, hr }
  }

  private rtWavePayload(): Uint8Array {
    const { spo2, hr } = this.liveValues()
    const n = 125
    const p = new Uint8Array(12 + n)
    p[0] = spo2
    p[1] = hr & 0xff
    p[2] = hr >> 8
    p[3] = 82
    p[4] = 0
    p[5] = 42 // PI 4.2
    p[6] = 1
    p[10] = n
    const beatsPerSample = hr / 60 / 125
    for (let i = 0; i < n; i++) {
      this.livePhase = (this.livePhase + beatsPerSample) % 1
      const y = plethShape(this.livePhase) + (this.rnd() - 0.5) * 0.02
      p[12 + i] = Math.max(0, Math.min(255, Math.round((1 - y) * 200)))
    }
    return p
  }

  onData(cb: (bytes: Uint8Array) => void): void {
    this.dataCb = cb
  }
  onDisconnect(cb: () => void): void {
    this.discCb = cb
  }
  /** Simulate an unexpected link drop (tests / UI). */
  drop(): void {
    this.connected = false
    this.discCb()
  }
  async reconnect(): Promise<void> {
    this.connected = true
  }
  disconnect(): void {
    if (!this.connected) return
    this.connected = false
    this.discCb()
  }
}
