import type { SqlJsStatic } from 'sql.js'
import { computeStats } from '../analytics'
import type { StoredSession } from '../../db/sessions'
import { readDesktopDb, isSqlite } from './desktopDb'
import { ImportError, parseO2VibeJson, type ImportFailure, type ImportNight, type ParsedImport } from './format'

export type ImportStage = 'reading' | 'opening' | 'parsing' | 'analysing' | 'saving'
export interface ImportProgress {
  stage: ImportStage
  done: number
  total: number
}

export interface BuiltImport {
  kind: ParsedImport['kind']
  sessions: StoredSession[]
  failed: ImportFailure[]
}

export function importedSession(n: ImportNight, now = Date.now()): StoredSession {
  const len = n.spo2.length
  const series = { start: n.start, intervalSec: n.intervalSec, spo2: n.spo2, pulse: n.pulse.slice(0, len) }
  return {
    id: `import:${n.fileName}`,
    source: 'import',
    deviceName: 'O2 desktop app',
    fileName: n.fileName,
    ...series,
    motion: n.motion?.slice(0, len) ?? [],
    stats: computeStats(series),
    importedAt: now,
    ...(n.notes ? { notes: n.notes } : {}),
  }
}

/** Detect the file type, parse it and compute stats. Pure (no IndexedDB) so it can run in a worker or in tests. */
export async function buildImport(bytes: Uint8Array, loadSql: () => Promise<SqlJsStatic>, onProgress: (p: ImportProgress) => void = () => {}): Promise<BuiltImport> {
  let parsed: ParsedImport
  if (isSqlite(bytes)) {
    onProgress({ stage: 'opening', done: 0, total: 1 })
    const SQL = await loadSql()
    parsed = readDesktopDb(SQL, bytes, (done, total) => onProgress({ stage: 'parsing', done, total }))
  } else {
    let i = 0
    while (i < bytes.length && i < 64 && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09 || bytes[i] === 0xef || bytes[i] === 0xbb || bytes[i] === 0xbf)) i++
    if (bytes[i] !== 0x7b) throw new ImportError('Unsupported file. Choose the desktop app’s .db file or an O2 Vibe export (.o2vibe.json).')
    onProgress({ stage: 'parsing', done: 0, total: 1 })
    parsed = parseO2VibeJson(new TextDecoder().decode(bytes))
  }
  const sessions: StoredSession[] = []
  const now = Date.now()
  parsed.nights.forEach((n, k) => {
    sessions.push(importedSession(n, now))
    onProgress({ stage: 'analysing', done: k + 1, total: parsed.nights.length })
  })
  return { kind: parsed.kind, sessions, failed: parsed.failed }
}
