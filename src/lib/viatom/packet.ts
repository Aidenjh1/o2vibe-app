import { crc8 } from './crc'
import { DEVICE_LEAD, FRAME_OVERHEAD, HEADER_LEN, HOST_LEAD, WRITE_CHUNK } from './constants'

/**
 * Frame layout (both directions):
 *   [0]   lead      0xAA host→device, 0x55 device→host
 *   [1]   cmd       host: opcode. device: status (0x00 = OK, anything else = error)
 *   [2]   ~[1]      bitwise inverse of byte 1
 *   [3-4] block     u16 LE — chunk index during file reads, otherwise 0
 *   [5-6] length    u16 LE — payload length
 *   [7..] payload
 *   [-1]  CRC-8 over all previous bytes
 */
export function buildFrame(cmd: number, block = 0, payload?: Uint8Array | string): Uint8Array {
  const body =
    payload === undefined
      ? new Uint8Array(0)
      : typeof payload === 'string'
        ? new TextEncoder().encode(payload)
        : payload
  const out = new Uint8Array(FRAME_OVERHEAD + body.length)
  out[0] = HOST_LEAD
  out[1] = cmd & 0xff
  out[2] = ~cmd & 0xff
  out[3] = block & 0xff
  out[4] = (block >> 8) & 0xff
  out[5] = body.length & 0xff
  out[6] = (body.length >> 8) & 0xff
  out.set(body, HEADER_LEN)
  out[out.length - 1] = crc8(out, 0, out.length - 1)
  return out
}

export interface Frame {
  lead: number
  /** For device responses this is the status byte (0 = OK). For host frames it is the opcode. */
  code: number
  block: number
  payload: Uint8Array
}

/** Parse one complete frame; throws on malformed input. */
export function parseFrame(bytes: Uint8Array): Frame {
  if (bytes.length < FRAME_OVERHEAD) throw new Error('Frame too short')
  if (bytes[1] !== (~bytes[2] & 0xff)) throw new Error('Command check byte mismatch')
  const len = bytes[5] | (bytes[6] << 8)
  if (bytes.length !== FRAME_OVERHEAD + len) throw new Error('Frame length mismatch')
  const want = crc8(bytes, 0, bytes.length - 1)
  if (want !== bytes[bytes.length - 1]) throw new Error(`CRC mismatch (got ${hex(bytes[bytes.length - 1])}, want ${hex(want)})`)
  return {
    lead: bytes[0],
    code: bytes[1],
    block: bytes[3] | (bytes[4] << 8),
    payload: bytes.slice(HEADER_LEN, bytes.length - 1),
  }
}

/** Split a frame into ≤20-byte writes (what the vendor SDK and o2r do). */
export function chunk(bytes: Uint8Array, size = WRITE_CHUNK): Uint8Array[] {
  const out: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.slice(i, i + size))
  return out
}

/**
 * Reassembles device responses from BLE notifications.
 *
 * Mirrors the vendor SDK's `hasResponse()`: scan the pool for 0x55, check the inverse byte,
 * wait for header+length+CRC bytes, verify CRC; on a bad candidate skip one byte and keep scanning,
 * so a stray/garbled notification can't wedge the stream.
 */
export class ResponseAssembler {
  private pool = new Uint8Array(0)
  /** Upper bound to avoid unbounded growth if the device sends garbage. */
  constructor(private readonly maxPool = 64 * 1024) {}

  get pending(): number {
    return this.pool.length
  }

  reset(): void {
    this.pool = new Uint8Array(0)
  }

  push(data: Uint8Array): Frame[] {
    const merged = new Uint8Array(this.pool.length + data.length)
    merged.set(this.pool)
    merged.set(data, this.pool.length)
    this.pool = merged.length > this.maxPool ? merged.slice(merged.length - this.maxPool) : merged
    return this.drain()
  }

  private drain(): Frame[] {
    const frames: Frame[] = []
    let i = 0
    const p = this.pool
    while (i + FRAME_OVERHEAD <= p.length) {
      if (p[i] !== DEVICE_LEAD || p[i + 1] !== (~p[i + 2] & 0xff)) {
        i++
        continue
      }
      const len = p[i + 5] | (p[i + 6] << 8)
      const total = FRAME_OVERHEAD + len
      if (i + total > p.length) break // wait for more data
      if (crc8(p, i, i + total - 1) === p[i + total - 1]) {
        frames.push(parseFrame(p.subarray(i, i + total)))
        i += total
      } else {
        i++
      }
    }
    // Keep from the first byte we haven't consumed (may be a partial frame).
    this.pool = p.slice(i)
    return frames
  }
}

export function hex(n: number): string {
  return '0x' + n.toString(16).padStart(2, '0')
}

export function toHex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ')
}
