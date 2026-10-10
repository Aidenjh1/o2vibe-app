import { fromRecording, hasSession, saveSession, sessionId } from '../db/sessions'
import { parseO2File } from '../lib/viatom/file'
import type { O2Client } from './client'

export interface SyncProgress {
  fileIndex: number
  fileCount: number
  fileName: string
  bytesDone: number
  bytesTotal: number
}

export interface SyncResult {
  found: number
  imported: number
  skipped: number
  failed: { file: string; error: string }[]
}

/** Download every recording on the device that isn't stored yet. */
export async function syncRecordings(client: O2Client, onProgress?: (p: SyncProgress) => void): Promise<SyncResult> {
  const info = await client.refreshInfo()
  const source = client.transport.kind === 'demo' ? 'demo' : 'device'
  const result: SyncResult = { found: info.files.length, imported: 0, skipped: 0, failed: [] }
  const todo: string[] = []
  for (const f of info.files) {
    if (await hasSession(sessionId(info.serial, client.name, f))) result.skipped++
    else todo.push(f)
  }
  for (let i = 0; i < todo.length; i++) {
    const fileName = todo[i]
    try {
      const bytes = await client.downloadFile(fileName, (done, total) =>
        onProgress?.({ fileIndex: i, fileCount: todo.length, fileName, bytesDone: done, bytesTotal: total }),
      )
      const rec = parseO2File(bytes)
      const ok = await saveSession(fromRecording(rec, { source, deviceName: client.name, serial: info.serial, fileName }))
      if (ok) result.imported++
      else result.skipped++
    } catch (e) {
      result.failed.push({ file: fileName, error: (e as Error).message })
    }
  }
  return result
}
