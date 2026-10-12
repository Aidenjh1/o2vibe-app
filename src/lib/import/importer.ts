import { saveSession } from '../../db/sessions'
import type { BuiltImport, ImportProgress } from './build'
import type { ImportFailure } from './format'

export type WorkerReply =
  | { type: 'progress'; progress: ImportProgress }
  | { type: 'done'; result: BuiltImport }
  | { type: 'error'; message: string; user?: boolean }

export interface ImportSummary {
  kind: BuiltImport['kind']
  found: number
  imported: number
  skipped: number
  failed: ImportFailure[]
  /** Range of all nights in the file (ms). */
  first?: number
  last?: number
  /** Imported nights that show a red / orange low-oxygen warning. */
  warnings: number
  importedIds: string[]
}

/** Parse in a worker (sql.js + stats off the main thread), then save to IndexedDB with de-duplication. */
export async function importFile(file: Blob, onProgress: (p: ImportProgress) => void): Promise<ImportSummary> {
  const worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' })
  let built: BuiltImport
  try {
    built = await new Promise<BuiltImport>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<WorkerReply>) => {
        const m = e.data
        if (m.type === 'progress') onProgress(m.progress)
        else if (m.type === 'done') resolve(m.result)
        else reject(new Error(m.message))
      }
      worker.onerror = (e) => reject(new Error(e.message || 'The import could not start.'))
      worker.postMessage({ file })
    })
  } finally {
    worker.terminate()
  }
  return saveBuilt(built, onProgress)
}

export async function saveBuilt(built: BuiltImport, onProgress: (p: ImportProgress) => void = () => {}): Promise<ImportSummary> {
  const s: ImportSummary = { kind: built.kind, found: built.sessions.length + built.failed.length, imported: 0, skipped: 0, failed: built.failed, warnings: 0, importedIds: [] }
  const total = built.sessions.length
  for (const [k, sess] of built.sessions.entries()) {
    if (await saveSession(sess)) {
      s.imported++
      s.importedIds.push(sess.id)
      if (sess.stats.level >= 2) s.warnings++
    } else s.skipped++
    s.first = Math.min(s.first ?? sess.start, sess.start)
    s.last = Math.max(s.last ?? sess.start, sess.start + sess.spo2.length * sess.intervalSec * 1000)
    onProgress({ stage: 'saving', done: k + 1, total })
  }
  return s
}
