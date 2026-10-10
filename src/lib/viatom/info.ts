import { parseDeviceTime } from './commands'

export interface DeviceInfo {
  model?: string
  serial?: string
  firmware?: string
  hardware?: string
  deviceTime?: Date | null
  battery?: number | null
  /** Stored recordings, oldest first, e.g. ["20261009230112", ...]. */
  files: string[]
  raw: Record<string, unknown>
}

/** Response to Cmd.INFO is a NUL-padded ASCII JSON object (o2r, vendor SDK OxyInfo). */
export function parseInfo(payload: Uint8Array): DeviceInfo {
  const text = new TextDecoder('latin1').decode(payload).replace(/\0+$/g, '').replace(/[\0\r\n\t]/g, ' ').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Device info is not JSON')
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  const s = (k: string) => (raw[k] === undefined ? undefined : String(raw[k]))
  const files = (s('FileList') ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter((f) => /^[\w.-]+$/.test(f))
  const bat = s('CurBAT')
  return {
    model: s('Model'),
    serial: s('SN'),
    firmware: s('SoftwareVer'),
    hardware: s('HardwareVer'),
    deviceTime: s('CurTIME') ? parseDeviceTime(s('CurTIME')!) : null,
    battery: bat ? parseInt(bat, 10) || null : null,
    files,
    raw,
  }
}

/** File names are usually the start timestamp, YYYYMMDDhhmmss. */
export function fileNameToDate(name: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m.map(Number)
  return new Date(y, mo - 1, d, h, mi, s)
}
