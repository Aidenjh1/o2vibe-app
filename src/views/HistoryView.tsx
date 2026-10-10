import type { StoredSession } from '../db/sessions'
import { Sparkline } from '../components/Sparkline'
import { IconChevron, IconDownload } from '../components/Icons'
import { formatClock, formatDuration, levelTone, ratingText, warningSummary } from '../lib/analytics'
import { downloadText, sessionsToCsv } from '../lib/csv'

export function nightLabel(start: number) {
  const d = new Date(start)
  // Recordings that start after midnight but before noon belong to the previous evening.
  const evening = new Date(d)
  if (d.getHours() < 12) evening.setDate(evening.getDate() - 1)
  const today = new Date()
  const yest = new Date(today)
  yest.setDate(today.getDate() - 1)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  const day = same(evening, yest) ? 'Last night' : same(evening, today) ? 'Tonight' : `${evening.toLocaleDateString([], { weekday: 'long' })} night`
  return { day, date: evening.toLocaleDateString([], { month: 'short', day: 'numeric' }) }
}


export function HistoryView({ sessions, onOpen, onConnect, onDemo, connected }: { sessions: StoredSession[]; onOpen: (id: string) => void; onConnect: () => void; onDemo: () => void; connected: boolean }) {
  if (!sessions.length) {
    return (
      <div className="view empty">
        <div className="empty-art">🌙</div>
        <h2>No nights saved yet</h2>
        <p className="muted">Wear your O2 Vibe overnight, then connect in the morning and tap “Download recordings”.</p>
        {!connected ? (
          <div className="stack">
            <button className="btn primary big" onClick={onConnect}>Connect my O2 Vibe</button>
            <button className="btn ghost big" onClick={onDemo}>Load demo nights</button>
          </div>
        ) : null}
      </div>
    )
  }
  const recent = sessions.slice(0, 7)
  const avg = (f: (s: StoredSession) => number | null) => {
    const v = recent.map(f).filter((x): x is number => x != null)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }
  const wkSpo2 = avg((s) => s.stats.avgSpo2)
  const wkDrops = avg((s) => s.stats.dropsPerHour)
  const wkPulse = avg((s) => s.stats.avgPulse)

  return (
    <div className="view">
      <div className="view-head">
        <h2>Your nights</h2>
        <button className="btn small ghost" onClick={() => downloadText(`o2vibe-summary-${new Date().toISOString().slice(0, 10)}.csv`, sessionsToCsv(sessions))}>
          <IconDownload width={18} height={18} /> Export
        </button>
      </div>

      <section className="week">
        <div className="week-title">Last {recent.length} night{recent.length === 1 ? '' : 's'} on average</div>
        <div className="week-stats">
          <div><b>{wkSpo2 != null ? wkSpo2.toFixed(0) : '--'}%</b><span>oxygen</span></div>
          <div><b>{wkDrops != null ? wkDrops.toFixed(1) : '--'}</b><span>drops / hour</span></div>
          <div><b>{wkPulse != null ? Math.round(wkPulse) : '--'}</b><span>bpm pulse</span></div>
        </div>
      </section>

      <ul className="night-list">
        {sessions.map((s) => {
          const st = s.stats
          const { day, date } = nightLabel(s.start)
          const w = warningSummary(st)
          return (
            <li key={s.id}>
              <button className={`night-card ${w ? 'has-warn' : ''}`} onClick={() => onOpen(s.id)}>
                {w ? (
                  <div className={`night-warn ${w.level === 3 ? 'critical' : 'bad'}`} role="alert">
                    <span aria-hidden="true">⚠</span> <b>{w.headline}</b>
                    {st.minSpo2 != null && st.minSpo2 < 90 ? <span> · lowest {st.minSpo2}%{st.minSpo2At ? ` at ${formatClock(st.minSpo2At)}` : ''}</span> : null}
                  </div>
                ) : null}
                <div className="night-top">
                  <div>
                    <div className="night-day">{day} <span className="muted">· {date}</span></div>
                    <div className="night-time muted">
                      {formatClock(s.start)} – {formatClock(s.start + st.durationSec * 1000)} · {formatDuration(st.durationSec)}
                    </div>
                  </div>
                  <span className={`chip-rating ${levelTone[st.level]}`}>{ratingText[st.rating]}</span>
                </div>
                <div className="night-main">
                  <div className="night-big">
                    <b>{st.avgSpo2 != null ? st.avgSpo2.toFixed(0) : '--'}<small>%</small></b>
                    <span>avg oxygen</span>
                  </div>
                  <div className="night-big">
                    <b className={st.minSpo2 != null && st.minSpo2 < 85 ? 'crit-text' : st.minSpo2 != null && st.minSpo2 < 90 ? 'bad-text' : ''}>{st.minSpo2 ?? '--'}<small>%</small></b>
                    <span>lowest</span>
                  </div>
                  <Sparkline values={s.spo2} />
                </div>
                <div className="night-foot">
                  <span><b>{formatDuration(st.timeBelow90Sec)}</b> under 90%</span>
                  <span><b>{st.drops}</b> drops ({st.dropsPerHour.toFixed(1)}/h)</span>
                  <span><b>{st.avgPulse != null ? Math.round(st.avgPulse) : '--'}</b> bpm{st.minPulse != null ? ` (${st.minPulse}–${st.maxPulse})` : ''}</span>
                  <IconChevron className="chev" width={18} height={18} />
                </div>
                {s.source === 'demo' ? <span className="demo-tag">demo</span> : null}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
