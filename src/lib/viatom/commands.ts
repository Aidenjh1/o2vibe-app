import { Cmd } from './constants'
import { buildFrame } from './packet'

const pad = (n: number) => String(n).padStart(2, '0')

/** Format a date the way the device expects "SetTIME"/"CurTIME": YYYY-MM-DD,HH:MM:SS (local time). */
export function formatDeviceTime(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())},${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function parseDeviceTime(s: string): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2}),(\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(s.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, se] = m.map(Number)
  return new Date(y, mo - 1, d, h, mi, se)
}

export const commands = {
  info: () => buildFrame(Cmd.INFO),
  ping: () => buildFrame(Cmd.PING),
  setTime: (d = new Date()) => buildFrame(Cmd.PARA_SYNC, 0, JSON.stringify({ SetTIME: formatDeviceTime(d) })),
  /** 0 = 125 Hz waveform, 1 = 62.5 Hz (vendor SDK). */
  rtWave: (rate = 0) => buildFrame(Cmd.RT_WAVE, 0, new Uint8Array([rate])),
  readSensors: () => buildFrame(Cmd.READ_SENSORS),
  fileOpen: (name: string) => buildFrame(Cmd.FILE_OPEN, 0, name + '\0'),
  fileRead: (block: number) => buildFrame(Cmd.FILE_READ, block),
  fileClose: () => buildFrame(Cmd.FILE_CLOSE),
}
