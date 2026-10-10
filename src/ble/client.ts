import { Cmd } from '../lib/viatom/constants'
import { commands } from '../lib/viatom/commands'
import { parseInfo, type DeviceInfo } from '../lib/viatom/info'
import { parseRtWave, parseSensors, type LiveReading } from '../lib/viatom/live'
import { ResponseAssembler, type Frame } from '../lib/viatom/packet'
import { O2Error, type Transport } from './transport'

export type LinkState = 'connected' | 'reconnecting' | 'disconnected'

export interface ClientEvents {
  onLive?: (r: LiveReading) => void
  onState?: (s: LinkState, detail?: string) => void
  onLog?: (line: string) => void
}

interface Pending {
  cmd: number
  block: number
  resolve: (f: Frame) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Talks the legacy Viatom O2 request/response protocol over any Transport.
 * One request in flight at a time (the device is strictly half-duplex), with timeouts and retries.
 */
export class O2Client {
  private assembler = new ResponseAssembler()
  private pending: Pending | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private liveTimer: ReturnType<typeof setTimeout> | null = null
  private liveMode: 'rtwave' | 'sensors' = 'rtwave'
  private liveFailures = 0
  private closing = false
  private paused = 0
  info: DeviceInfo | null = null

  constructor(
    readonly transport: Transport,
    private events: ClientEvents = {},
  ) {
    transport.onData((b) => this.onData(b))
    transport.onDisconnect(() => void this.onDrop())
  }

  get name(): string {
    return this.transport.name
  }

  private log(s: string) {
    this.events.onLog?.(s)
  }

  private onData(bytes: Uint8Array) {
    for (const f of this.assembler.push(bytes)) {
      const p = this.pending
      if (!p) continue
      // During file reads the device echoes the block number; ignore stale/duplicate chunks.
      if (p.cmd === Cmd.FILE_READ && f.block !== p.block) continue
      clearTimeout(p.timer)
      this.pending = null
      p.resolve(f)
    }
  }

  private async onDrop() {
    this.stopLiveTimer()
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending.reject(new O2Error('disconnected', 'The device disconnected.'))
      this.pending = null
    }
    if (this.closing) {
      this.events.onState?.('disconnected')
      return
    }
    // Unexpected drop: retry a few times with backoff.
    const delays = [500, 1500, 3000, 6000, 12000]
    for (const d of delays) {
      this.events.onState?.('reconnecting', `Trying again in ${Math.round(d / 1000) || 1}s…`)
      await sleep(d)
      if (this.closing) break
      try {
        await this.transport.reconnect()
        this.assembler.reset()
        this.events.onState?.('connected')
        if (this.liveWanted) this.startLive()
        return
      } catch (e) {
        this.log(`reconnect failed: ${(e as Error).message}`)
        if (e instanceof O2Error && (e.code === 'newer_protocol' || e.code === 'wrong_device')) break
      }
    }
    this.events.onState?.('disconnected', 'Lost connection to the oximeter.')
  }

  /** Send one frame and wait for its response. Serialised. */
  request(cmd: number, frame: Uint8Array, opts: { block?: number; timeoutMs?: number; retries?: number } = {}): Promise<Frame> {
    const run = async () => {
      const retries = opts.retries ?? 2
      let last: Error | null = null
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          return await this.once(cmd, frame, opts.block ?? 0, opts.timeoutMs ?? 3000)
        } catch (e) {
          last = e as Error
          if (e instanceof O2Error && e.code === 'disconnected') throw e
          this.assembler.reset()
        }
      }
      throw last ?? new O2Error('timeout', 'No answer from the device.')
    }
    const p = this.queue.then(run, run)
    this.queue = p.catch(() => undefined)
    return p
  }

  private once(cmd: number, frame: Uint8Array, block: number, timeoutMs: number): Promise<Frame> {
    return new Promise<Frame>((resolve, reject) => {
      if (!this.transport.connected) return reject(new O2Error('disconnected', 'The device is not connected.'))
      const timer = setTimeout(() => {
        if (this.pending?.timer === timer) this.pending = null
        reject(new O2Error('timeout', 'The device did not answer in time.'))
      }, timeoutMs)
      this.pending = { cmd, block, resolve, reject, timer }
      this.transport.write(frame).catch((e) => {
        clearTimeout(timer)
        this.pending = null
        reject(e)
      })
    })
  }

  /** Called right after connecting: set the clock (best effort) and read device info. */
  async init(): Promise<DeviceInfo> {
    try {
      await this.request(Cmd.PARA_SYNC, commands.setTime(new Date()), { retries: 1 })
    } catch (e) {
      this.log(`set time failed: ${(e as Error).message}`)
    }
    return this.refreshInfo()
  }

  async refreshInfo(): Promise<DeviceInfo> {
    const f = await this.request(Cmd.INFO, commands.info(), { timeoutMs: 4000 })
    if (f.code !== 0) throw new O2Error('protocol', 'The device refused the info request.')
    this.info = parseInfo(f.payload)
    return this.info
  }

  /** Download a stored recording. Returns raw bytes. */
  async downloadFile(name: string, onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
    this.paused++
    try {
      const open = await this.request(Cmd.FILE_OPEN, commands.fileOpen(name), { timeoutMs: 5000 })
      if (open.code !== 0 || open.payload.length < 4) {
        await this.request(Cmd.FILE_CLOSE, commands.fileClose(), { retries: 0 }).catch(() => undefined)
        throw new O2Error('protocol', `The device could not open recording ${name}.`, 'If a recording is in progress, take the sensor off and wait for the device to finish saving.')
      }
      const p = open.payload
      const size = (p[0] | (p[1] << 8) | (p[2] << 16)) + p[3] * 0x1000000
      if (size <= 0 || size > 8 * 1024 * 1024) throw new O2Error('protocol', `Unexpected recording size ${size}.`)
      const out = new Uint8Array(size)
      let got = 0
      let block = 0
      while (got < size) {
        const f = await this.request(Cmd.FILE_READ, commands.fileRead(block), { block, timeoutMs: 4000, retries: 3 })
        if (f.code !== 0) throw new O2Error('protocol', 'The device reported an error while sending the recording.')
        if (f.payload.length === 0) break
        const take = Math.min(f.payload.length, size - got)
        out.set(f.payload.subarray(0, take), got)
        got += take
        block++
        onProgress?.(got, size)
      }
      await this.request(Cmd.FILE_CLOSE, commands.fileClose(), { retries: 1 }).catch(() => undefined)
      if (got < size) throw new O2Error('protocol', 'The recording download ended early.')
      return out
    } finally {
      this.paused--
    }
  }

  private liveWanted = false

  startLive(intervalMs = 1000): void {
    this.liveWanted = true
    this.stopLiveTimer()
    const tick = async () => {
      if (!this.liveWanted) return
      if (this.paused === 0 && this.transport.connected) await this.pollOnce()
      if (this.liveWanted) this.liveTimer = setTimeout(tick, intervalMs)
    }
    void tick()
  }

  stopLive(): void {
    this.liveWanted = false
    this.stopLiveTimer()
  }

  private stopLiveTimer() {
    if (this.liveTimer) clearTimeout(this.liveTimer)
    this.liveTimer = null
  }

  private async pollOnce() {
    try {
      let r: LiveReading | null
      if (this.liveMode === 'rtwave') {
        const f = await this.request(Cmd.RT_WAVE, commands.rtWave(0), { retries: 0, timeoutMs: 2000 })
        r = f.code === 0 ? parseRtWave(f.payload) : null
      } else {
        const f = await this.request(Cmd.READ_SENSORS, commands.readSensors(), { retries: 0, timeoutMs: 2000 })
        r = f.code === 0 ? parseSensors(f.payload) : null
      }
      if (r) {
        this.liveFailures = 0
        this.events.onLive?.(r)
      } else this.noteLiveFailure()
    } catch (e) {
      if (e instanceof O2Error && e.code === 'disconnected') return
      this.noteLiveFailure()
    }
  }

  private noteLiveFailure() {
    this.liveFailures++
    if (this.liveFailures >= 3) {
      // Some firmware only implements one of the two live commands.
      this.liveMode = this.liveMode === 'rtwave' ? 'sensors' : 'rtwave'
      this.liveFailures = 0
      this.log(`switching live mode to ${this.liveMode}`)
    }
  }

  disconnect(): void {
    this.closing = true
    this.stopLive()
    this.transport.disconnect()
  }
}
