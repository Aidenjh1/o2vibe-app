import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { computeStats, STATS_VERSION, type SessionStats } from '../lib/analytics'
import type { O2Recording } from '../lib/viatom/file'

export interface StoredSession {
  /** Stable id: device serial (or name) + file name → re-syncing never duplicates. */
  id: string
  source: 'device' | 'demo'
  deviceName: string
  serial?: string
  fileName: string
  start: number
  intervalSec: number
  spo2: (number | null)[]
  pulse: (number | null)[]
  motion: number[]
  stats: SessionStats
  importedAt: number
}

interface O2DB extends DBSchema {
  sessions: { key: string; value: StoredSession; indexes: { byStart: number } }
}

let dbp: Promise<IDBPDatabase<O2DB>> | null = null
function db() {
  if (!dbp) {
    dbp = openDB<O2DB>('o2vibe', 1, {
      upgrade(d) {
        const s = d.createObjectStore('sessions', { keyPath: 'id' })
        s.createIndex('byStart', 'start')
      },
    })
  }
  return dbp
}

export function sessionId(serial: string | undefined, deviceName: string, fileName: string): string {
  return `${(serial || deviceName).replace(/\s+/g, '_')}:${fileName}`
}

export function fromRecording(rec: O2Recording, meta: { source: StoredSession['source']; deviceName: string; serial?: string; fileName: string }): StoredSession {
  const series = { start: rec.header.start.getTime(), intervalSec: rec.intervalSec, spo2: rec.spo2, pulse: rec.pulse }
  return {
    id: sessionId(meta.serial, meta.deviceName, meta.fileName),
    ...meta,
    ...series,
    motion: rec.motion,
    stats: computeStats(series),
    importedAt: Date.now(),
  }
}

export async function hasSession(id: string): Promise<boolean> {
  return (await (await db()).getKey('sessions', id)) !== undefined
}

/** Returns false if it already existed (deduped). */
export async function saveSession(s: StoredSession): Promise<boolean> {
  const d = await db()
  const tx = d.transaction('sessions', 'readwrite')
  let exists = (await tx.store.getKey(s.id)) !== undefined
  // Also dedupe on identical start time + length (same night imported under another device name).
  if (!exists) {
    const sameStart = await tx.store.index('byStart').getAll(s.start)
    exists = sameStart.some((o) => o.spo2.length === s.spo2.length)
  }
  if (!exists) await tx.store.put(s)
  await tx.done
  return !exists
}

/** Nights saved by an older version carry older stats: recompute from the raw samples so new rules apply. */
function fresh(s: StoredSession): StoredSession {
  if (s.stats?.version === STATS_VERSION) return s
  return { ...s, stats: computeStats(s) }
}

export async function listSessions(): Promise<StoredSession[]> {
  const all = await (await db()).getAllFromIndex('sessions', 'byStart')
  return all.reverse().map(fresh)
}

export async function getSession(id: string): Promise<StoredSession | undefined> {
  const s = await (await db()).get('sessions', id)
  return s && fresh(s)
}

export async function deleteSession(id: string): Promise<void> {
  await (await db()).delete('sessions', id)
}

export async function deleteBySource(source: StoredSession['source']): Promise<number> {
  const d = await db()
  const all = await d.getAll('sessions')
  const tx = d.transaction('sessions', 'readwrite')
  let n = 0
  for (const s of all) {
    if (s.source === source) {
      await tx.store.delete(s.id)
      n++
    }
  }
  await tx.done
  return n
}
