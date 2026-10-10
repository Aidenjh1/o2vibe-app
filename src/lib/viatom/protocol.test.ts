import { describe, expect, it } from 'vitest'
import { crc8, crc8ReferenceO2r } from './crc'
import { buildFrame, chunk, parseFrame, ResponseAssembler } from './packet'
import { commands, formatDeviceTime, parseDeviceTime } from './commands'
import { Cmd } from './constants'
import { parseRtWave, parseSensors } from './live'
import { fileNameToDate, parseInfo } from './info'
import { encodeO2File, inferInterval, parseO2File } from './file'
import { buildResponse } from '../../demo/fakeDevice'

const hex = (s: string) => new Uint8Array(s.trim().split(/\s+/).map((x) => parseInt(x, 16)))

describe('CRC-8', () => {
  it('matches the known O2 "read sensors" request from viatom-ble (aa 17 e8 00 00 00 00 1b)', () => {
    expect(crc8(hex('aa 17 e8 00 00 00 00'))).toBe(0x1b)
  })
  it('matches the CRC fixture from nglessner/o2ring-s-protocol (A5 E1 1E 00 02 00 00 → BF)', () => {
    expect(crc8(hex('a5 e1 1e 00 02 00 00'))).toBe(0xbf)
  })
  it('is identical to the o2r / farolone bit-trick implementation for random data', () => {
    let seed = 7
    for (let n = 0; n < 200; n++) {
      const len = (seed = (seed * 1103515245 + 12345) >>> 0) % 64
      const buf = new Uint8Array(len)
      for (let i = 0; i < len; i++) buf[i] = (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24
      expect(crc8(buf)).toBe(crc8ReferenceO2r(buf))
    }
  })
  it('CRC-8/SMBUS check value for "123456789" is 0xF4', () => {
    expect(crc8(new TextEncoder().encode('123456789'))).toBe(0xf4)
  })
})

describe('frame building', () => {
  it('builds the exact read-sensors request used by viatom-ble', () => {
    expect(Array.from(commands.readSensors())).toEqual(Array.from(hex('aa 17 e8 00 00 00 00 1b')))
  })
  it('builds INFO as in the vendor SDK (aa 14 eb 00 00 00 00 crc)', () => {
    const f = commands.info()
    expect(Array.from(f.subarray(0, 7))).toEqual([0xaa, 0x14, 0xeb, 0, 0, 0, 0])
    expect(f[7]).toBe(crc8(f.subarray(0, 7)))
  })
  it('puts the block number little-endian for file reads', () => {
    const f = commands.fileRead(0x0102)
    expect(f[1]).toBe(Cmd.FILE_READ)
    expect(f[2]).toBe(0xfb)
    expect([f[3], f[4]]).toEqual([0x02, 0x01])
    expect(f.length).toBe(8)
  })
  it('NUL-terminates file names and encodes length', () => {
    const f = commands.fileOpen('20261009223015')
    expect(f[5] | (f[6] << 8)).toBe(15)
    expect(f[7 + 14]).toBe(0)
    expect(new TextDecoder().decode(f.subarray(7, 21))).toBe('20261009223015')
  })
  it('RT wave request carries the 1-byte rate', () => {
    const f = commands.rtWave(0)
    expect(Array.from(f.subarray(0, 8))).toEqual([0xaa, 0x1b, 0xe4, 0, 0, 1, 0, 0])
  })
  it('set-time JSON uses YYYY-MM-DD,HH:MM:SS', () => {
    const d = new Date(2026, 9, 10, 7, 5, 9)
    expect(formatDeviceTime(d)).toBe('2026-10-10,07:05:09')
    const f = commands.setTime(d)
    expect(new TextDecoder().decode(f.subarray(7, f.length - 1))).toBe('{"SetTIME":"2026-10-10,07:05:09"}')
    expect(parseDeviceTime('2026-10-10,07:05:09')?.getTime()).toBe(d.getTime())
  })
  it('round-trips through parseFrame', () => {
    const f = buildFrame(0x22, 5, new Uint8Array([1, 2, 3]))
    const p = parseFrame(f)
    expect(p.code).toBe(0x22)
    expect(p.block).toBe(5)
    expect(Array.from(p.payload)).toEqual([1, 2, 3])
  })
  it('rejects bad CRC / bad inverse byte / bad length', () => {
    const f = buildFrame(0x14)
    const bad = f.slice()
    bad[7] ^= 1
    expect(() => parseFrame(bad)).toThrow(/CRC/)
    const inv = f.slice()
    inv[2] = 0
    expect(() => parseFrame(inv)).toThrow(/check/)
    expect(() => parseFrame(f.subarray(0, 6))).toThrow()
  })
  it('chunks writes into 20-byte pieces', () => {
    const big = new Uint8Array(45).map((_, i) => i)
    const parts = chunk(big)
    expect(parts.map((p) => p.length)).toEqual([20, 20, 5])
    expect(Array.from(parts[2])).toEqual([40, 41, 42, 43, 44])
  })
})

describe('response reassembly', () => {
  const payload = new Uint8Array(300).map((_, i) => (i * 7) & 0xff)
  const resp = buildResponse(0, 3, payload)

  it('reassembles a response split into 20-byte notifications', () => {
    const a = new ResponseAssembler()
    const frames = chunk(resp).flatMap((c) => a.push(c))
    expect(frames).toHaveLength(1)
    expect(frames[0].block).toBe(3)
    expect(frames[0].code).toBe(0)
    expect(Array.from(frames[0].payload)).toEqual(Array.from(payload))
    expect(a.pending).toBe(0)
  })
  it('handles two responses in one notification and leading garbage', () => {
    const a = new ResponseAssembler()
    const r1 = buildResponse(0, 0, new Uint8Array([9]))
    const r2 = buildResponse(1, 0, new Uint8Array([]))
    const blob = new Uint8Array([0x00, 0x55, 0x12, ...r1, ...r2])
    const frames = a.push(blob)
    expect(frames.map((f) => f.code)).toEqual([0, 1])
  })
  it('skips a corrupted frame and recovers on the next one', () => {
    const a = new ResponseAssembler()
    const broken = buildResponse(0, 0, new Uint8Array([1, 2, 3]))
    broken[8] ^= 0xff
    const good = buildResponse(0, 0, new Uint8Array([4, 5]))
    const frames = [...a.push(broken), ...a.push(good)]
    expect(frames).toHaveLength(1)
    expect(Array.from(frames[0].payload)).toEqual([4, 5])
  })
  it('waits when the length says more data is coming', () => {
    const a = new ResponseAssembler()
    expect(a.push(resp.subarray(0, 100))).toHaveLength(0)
    expect(a.push(resp.subarray(100))).toHaveLength(1)
  })
})

describe('live data parsing', () => {
  it('parses RT wave (0x1B) payload per vendor SDK layout', () => {
    const p = new Uint8Array(12 + 5)
    p.set([97, 72, 0, 85, 1, 35, 1], 0)
    p[10] = 5
    p.set([0, 100, 156, 200, 50], 12)
    const r = parseRtWave(p)!
    expect(r.spo2).toBe(97)
    expect(r.pulse).toBe(72)
    expect(r.battery).toBe(85)
    expect(r.batteryState).toBe(1)
    expect(r.pi).toBeCloseTo(3.5)
    expect(r.sensorOn).toBe(true)
    expect(r.pleth).toHaveLength(5)
    expect(r.pleth[0]).toBe(1)
    expect(r.pleth[1]).toBeCloseTo(0.5)
    expect(r.pleth[2]).toBeCloseTo(0.25) // 156 = invalid marker, interpolated from neighbours (100+200)/2
  })
  it('reports no values when the finger is out', () => {
    const p = new Uint8Array(12)
    p.set([255, 255, 1, 60, 0, 0, 0])
    const r = parseRtWave(p)!
    expect(r.sensorOn).toBe(false)
    expect(r.spo2).toBeNull()
    expect(r.pulse).toBeNull()
  })
  it('parses READ_SENSORS (0x17) payload per o2r', () => {
    const p = hex('62 42 00 00 00 00 00 61 00 92 0a 01 00')
    const r = parseSensors(p)!
    expect(r.spo2).toBe(98)
    expect(r.pulse).toBe(66)
    expect(r.battery).toBe(97)
    expect(r.motion).toBe(0x92)
    expect(r.sensorOn).toBe(true)
  })
  it('flags no-finger READ_SENSORS samples (o2r capture "ffffff00…")', () => {
    const r = parseSensors(hex('ff ff ff 00 00 00 00 60 00 05 00 00 00'))!
    expect(r.sensorOn).toBe(false)
    expect(r.spo2).toBeNull()
  })
})

describe('device info', () => {
  it('parses NUL padded INFO JSON and the file list', () => {
    const json = '{"Region":"CE","Model":"1652","HardwareVer":"AA","SoftwareVer":"1.4.0","SN":"2010123456","CurTIME":"2026-10-10,06:59:00","CurBAT":"76%","FileList":"20261008224510,20261009230002,"}'
    const info = parseInfo(new TextEncoder().encode(json + '\0\0\0\0'))
    expect(info.serial).toBe('2010123456')
    expect(info.firmware).toBe('1.4.0')
    expect(info.battery).toBe(76)
    expect(info.files).toEqual(['20261008224510', '20261009230002'])
    expect(info.deviceTime?.getHours()).toBe(6)
  })
  it('handles an empty file list', () => {
    expect(parseInfo(new TextEncoder().encode('{"FileList":""}')).files).toEqual([])
  })
  it('turns file names into dates', () => {
    expect(fileNameToDate('20261009230002')?.getDate()).toBe(9)
    expect(fileNameToDate('nope')).toBeNull()
  })
})

describe('stored recording parsing', () => {
  // Hand-written fixture: version 3, 2026-10-09 23:00:00, 3 records at 4 s (record time 12 s).
  const fixture = hex(`
    03 00 ea 07 0a 09 17 00 00  37 00 00 00  0c 00 00 00  60 59 01 01  04 00 01 21 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
    61 3c 00 02 00
    59 41 00 00 00
    ff ff ff 05 00`)

  it('parses a hand-built fixture', () => {
    expect(fixture.length).toBe(55)
    const r = parseO2File(fixture)
    expect(r.header.version).toBe(3)
    expect(r.header.start.getFullYear()).toBe(2026)
    expect(r.header.start.getMonth()).toBe(9)
    expect(r.header.start.getHours()).toBe(23)
    expect(r.header.recordTimeSec).toBe(12)
    expect(r.header.avgSpo2).toBe(96)
    expect(r.header.minSpo2).toBe(89)
    expect(r.header.timeBelow90Sec).toBe(4)
    expect(r.intervalSec).toBe(4)
    expect(r.spo2).toEqual([97, 89, null])
    expect(r.pulse).toEqual([60, 65, null])
    expect(r.motion).toEqual([2, 0, 5])
    expect(r.t[1] - r.t[0]).toBe(4000)
  })
  it('reads 2-byte pulse values above 255', () => {
    const f = fixture.slice()
    f[40 + 1] = 0x04
    f[40 + 2] = 0x01 // 260 → out of range → null
    expect(parseO2File(f).pulse[0]).toBeNull()
  })
  it('round-trips with the encoder at 2 s and 4 s', () => {
    for (const intervalSec of [2, 4]) {
      const start = new Date(2026, 9, 9, 22, 41, 7)
      const spo2 = [96, 95, null, 88, 97]
      const pulse = [61, 62, null, 70, 59]
      const r = parseO2File(encodeO2File({ start, intervalSec, spo2, pulse, motion: [0, 1, 2, 3, 4] }))
      expect(r.intervalSec).toBe(intervalSec)
      expect(r.header.start.getTime()).toBe(start.getTime())
      expect(r.spo2).toEqual(spo2)
      expect(r.pulse).toEqual(pulse)
    }
  })
  it('rejects unknown versions and truncated files', () => {
    const f = fixture.slice()
    f[0] = 9
    expect(() => parseO2File(f)).toThrow(/version/)
    expect(() => parseO2File(fixture.subarray(0, 30))).toThrow()
    expect(() => parseO2File(fixture.subarray(0, 40))).toThrow(/no samples/)
  })
  it('infers sample interval', () => {
    expect(inferInterval(36000, 9000)).toBe(4)
    expect(inferInterval(36000, 18000)).toBe(2)
    expect(inferInterval(36001, 36000)).toBe(1)
    expect(inferInterval(0, 10)).toBe(4)
  })
})
