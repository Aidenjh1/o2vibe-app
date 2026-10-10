export interface LiveReading {
  /** SpO2 %, or null when there is no valid reading (finger out / searching). */
  spo2: number | null
  /** Pulse rate bpm, or null when invalid. */
  pulse: number | null
  /** Battery % (0-100) when known. */
  battery: number | null
  /** 0 = not charging, 1 = charging, 2 = full (vendor SDK). */
  batteryState: number | null
  /** Perfusion index (%), when provided. */
  pi: number | null
  /** True when the finger sensor reports contact. */
  sensorOn: boolean
  motion: number | null
  /** Pleth samples normalised to 0..1 (1 = top of the pulse), oldest first. */
  pleth: number[]
  at: number
  source: 'rtwave' | 'sensors' | 'demo'
}

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const validSpo2 = (v: number) => (v >= 35 && v <= 100 ? v : null)
const validPulse = (v: number) => (v >= 25 && v <= 250 ? v : null)

/**
 * Payload of response to Cmd.RT_WAVE (0x1B) — vendor SDK OxyBleResponse.RtWave:
 *   [0] spo2, [1-2] pr u16, [3] battery, [4] battery state, [5] PI (/10), [6] state (1 = lead on)
 *   [7-9] reserved, [10-11] wave length u16, [12..] wave bytes. Byte value 156 marks an invalid point.
 * The SDK draws (100 - v/2), i.e. larger raw values are lower on screen; we invert to 0..1 accordingly.
 */
export function parseRtWave(p: Uint8Array, at = Date.now()): LiveReading | null {
  if (p.length < 7) return null
  const sensorOn = p[6] === 1
  const n = p.length >= 12 ? Math.min(u16(p, 10), p.length - 12) : 0
  const raw: number[] = []
  for (let i = 0; i < n; i++) raw.push(p[12 + i])
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 156) raw[i] = i === 0 ? (raw[1] ?? 128) : i === raw.length - 1 ? raw[i - 1] : (raw[i - 1] + raw[i + 1]) / 2
  }
  const pleth = raw.map((v) => Math.max(0, Math.min(1, 1 - v / 200)))
  return {
    spo2: sensorOn ? validSpo2(p[0]) : null,
    pulse: sensorOn ? validPulse(u16(p, 1)) : null,
    battery: p[3] <= 100 ? p[3] : null,
    batteryState: p[4],
    pi: p[5] ? p[5] / 10 : null,
    sensorOn,
    motion: null,
    pleth,
    at,
    source: 'rtwave',
  }
}

/**
 * Payload of response to Cmd.READ_SENSORS (0x17) — o2r o2state.py / ecostech viatom-ble
 * (viatom-ble indexes are +7 because they include the frame header):
 *   [0] spo2, [1] hr, [7] battery, [8] charging, [9] motion, [10] PI/signal strength, [11] finger present
 */
export function parseSensors(p: Uint8Array, at = Date.now()): LiveReading | null {
  if (p.length < 12) return null
  const sensorOn = p[11] !== 0
  return {
    spo2: sensorOn ? validSpo2(p[0]) : null,
    pulse: sensorOn ? validPulse(p[1]) : null,
    battery: p[7] <= 100 ? p[7] : null,
    batteryState: p[8],
    pi: p[10] ? p[10] / 10 : null,
    sensorOn,
    motion: p[9],
    pleth: [],
    at,
    source: 'sensors',
  }
}
