import { useEffect, useRef, useState } from 'react'
import type { ImportProgress } from '../lib/import/build'
import type { ImportSummary } from '../lib/import/importer'
import { IconImport } from './Icons'

type State = { s: 'idle' } | { s: 'working'; file: string; p: ImportProgress } | { s: 'done'; file: string; sum: ImportSummary } | { s: 'error'; file: string; message: string }

const stageText: Record<ImportProgress['stage'], string> = {
  reading: 'Reading file…',
  opening: 'Opening database…',
  parsing: 'Reading nights…',
  analysing: 'Analysing nights…',
  saving: 'Saving to this phone…',
}
// Rough share of the bar each stage takes.
const stageSpan: Record<ImportProgress['stage'], [number, number]> = {
  reading: [0, 0.1],
  opening: [0.1, 0.2],
  parsing: [0.2, 0.55],
  analysing: [0.55, 0.85],
  saving: [0.85, 1],
}

const day = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export function ImportSheet({ onClose, onImported }: { onClose: () => void; onImported: () => void | Promise<void> }) {
  const [st, setSt] = useState<State>({ s: 'idle' })
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && st.s !== 'working' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [st.s, onClose])

  const run = async (file: File) => {
    setSt({ s: 'working', file: file.name, p: { stage: 'reading', done: 0, total: 1 } })
    try {
      const { importFile } = await import('../lib/import/importer')
      const sum = await importFile(file, (p) => setSt({ s: 'working', file: file.name, p }))
      await onImported()
      setSt({ s: 'done', file: file.name, sum })
    } catch (e) {
      setSt({ s: 'error', file: file.name, message: e instanceof Error ? e.message : String(e) })
    }
  }

  const pct = st.s === 'working' ? (() => {
    const [a, b] = stageSpan[st.p.stage]
    return Math.round((a + (b - a) * (st.p.total ? st.p.done / st.p.total : 0)) * 100)
  })() : 0

  return (
    <div className="sheet-backdrop" onClick={() => st.s !== 'working' && onClose()}>
      <div className="sheet import-sheet" role="dialog" aria-modal="true" aria-labelledby="import-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="import-title">Import older nights</h3>
        <input
          ref={input}
          type="file"
          hidden
          data-testid="import-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void run(f)
          }}
        />

        {st.s === 'idle' ? (
          <>
            <p>Bring in nights recorded with the <b>O2 desktop app</b>. Choose its database file (<code>.db</code>) or an O2 Vibe export (<code>.o2vibe.json</code>).</p>
            <ul className="plain small muted">
              <li>Get the file onto this phone first, e.g. save it to Google Drive or email it to yourself and download it.</li>
              <li>Nights already on this phone are skipped, so importing twice is safe.</li>
              <li>Everything is read on this phone. Nothing is uploaded.</li>
            </ul>
            <div className="sheet-actions">
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn primary" onClick={() => input.current?.click()}><IconImport /> Choose file</button>
            </div>
          </>
        ) : null}

        {st.s === 'working' ? (
          <div className="import-progress" aria-live="polite">
            <div className="muted small ellipsis">{st.file}</div>
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <span style={{ width: `${pct}%` }} />
            </div>
            <div className="import-stage">
              <span>{stageText[st.p.stage]}</span>
              {st.p.total > 1 ? <span className="muted">{st.p.done} / {st.p.total}</span> : null}
            </div>
          </div>
        ) : null}

        {st.s === 'done' ? (
          <div className="import-result" aria-live="polite">
            <div className="import-big">
              <b>{st.sum.imported}</b>
              <span>{st.sum.imported === 1 ? 'night imported' : 'nights imported'}</span>
            </div>
            <ul className="import-facts">
              {st.sum.skipped ? <li><b>{plural(st.sum.skipped, 'night')}</b> skipped — already on this phone</li> : null}
              {st.sum.failed.length ? <li className="bad-text"><b>{plural(st.sum.failed.length, 'recording')}</b> could not be read</li> : null}
              {st.sum.first != null && st.sum.last != null ? <li>Covers <b>{day(st.sum.first)}</b> to <b>{day(st.sum.last)}</b></li> : null}
              {st.sum.warnings ? <li className="crit-text"><b>{plural(st.sum.warnings, 'imported night')}</b> {st.sum.warnings === 1 ? 'has' : 'have'} a low-oxygen warning</li> : null}
              {st.sum.found === 0 ? <li>No recordings were found in this file.</li> : null}
            </ul>
            {st.sum.failed.length ? (
              <details className="small muted">
                <summary>Details</summary>
                <ul className="plain">{st.sum.failed.map((f, i) => <li key={i}>{f.label}: {f.error}</li>)}</ul>
              </details>
            ) : null}
            <div className="sheet-actions">
              <button className="btn ghost" onClick={() => setSt({ s: 'idle' })}>Import another</button>
              <button className="btn primary" onClick={onClose}>See my nights</button>
            </div>
          </div>
        ) : null}

        {st.s === 'error' ? (
          <div className="import-result" role="alert">
            <p className="bad-text"><b>Couldn’t import {st.file}</b></p>
            <p>{st.message}</p>
            <div className="sheet-actions">
              <button className="btn ghost" onClick={onClose}>Close</button>
              <button className="btn primary" onClick={() => input.current?.click()}>Choose another file</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
