/// <reference lib="webworker" />
import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { buildImport, type ImportProgress } from './build'
import type { WorkerReply } from './importer'

const ctx = self as unknown as DedicatedWorkerGlobalScope
const post = (m: WorkerReply) => ctx.postMessage(m)

ctx.onmessage = async (e: MessageEvent<{ file: Blob }>) => {
  try {
    post({ type: 'progress', progress: { stage: 'reading', done: 0, total: 1 } })
    const bytes = new Uint8Array(await e.data.file.arrayBuffer())
    let last = 0
    const result = await buildImport(bytes, () => initSqlJs({ locateFile: () => wasmUrl }), (p: ImportProgress) => {
      const now = performance.now()
      if (p.done === p.total || now - last > 50) {
        last = now
        post({ type: 'progress', progress: p })
      }
    })
    post({ type: 'done', result })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err), user: err instanceof Error && err.name === 'ImportError' })
  }
}
