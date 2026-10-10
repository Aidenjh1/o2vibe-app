import { useState } from 'react'
import type { StoredSession } from '../db/sessions'
import { SessionChart } from '../components/SessionChart'
import { ZoneBar } from '../components/ZoneBar'
import { IconBack, IconDownload, IconTrash } from '../components/Icons'
import { formatClock, formatDuration, insights } from '../lib/analytics'
import { downloadText, sessionToCsv } from '../lib/csv'
import { nightLabel, ratingText } from './HistoryView'

const toneIcon = { good: '✓', warn: '!', bad: '!!', none: 'i' } as const

export function SessionView({ session, theme, onBack, onDelete }: { session: StoredSession; theme: string; onBack: () => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const st = session.stats
  const { day, date } = nightLabel(session.start)
  const list = insights(session, st)
  const tone = st.rating === 'good' ? 'good' : st.rating === 'fair' ? 'warn' : 'bad'
  const end = session.start + st.durationSec * 1000
  const fname = `o2vibe-${new Date(session.start).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`

  return (
    <div className="view detail">
      <div className="detail-head">
        <button className="icon-btn" onClick={onBack} aria-label="Back to history"><IconBack /></button>
        <div>
          <h2>{day} <span className="muted">· {date}</span></h2>
          <div className="muted small">{formatClock(session.start)} – {formatClock(end)} · {formatDuration(st.durationSec)}{session.source === 'demo' ? ' · demo data' : ''}</div>
        </div>
      </div>

      <section className={`summary-banner ${tone}`}>
        <b>{ratingText[st.rating]}</b>
        <span>{(st.rating === 'good' ? list[0] : list.find((i) => i.tone === 'bad') ?? list.find((i) => i.tone === 'warn') ?? list[0])?.text}</span>
      </section>

      <section className="stat-grid">
        <Stat label="Avg oxygen" value={st.avgSpo2 != null ? `${st.avgSpo2.toFixed(0)}%` : '--'} />
        <Stat label="Lowest oxygen" value={st.minSpo2 != null ? `${st.minSpo2}%` : '--'} tone={st.minSpo2 != null && st.minSpo2 < 90 ? 'bad' : undefined} sub={st.minSpo2At ? `at ${formatClock(st.minSpo2At)}` : undefined} />
        <Stat label="Under 90%" value={formatDuration(st.timeBelow90Sec)} sub={`${st.pctBelow90.toFixed(1)}% of the night`} />
        <Stat label="Oxygen drops" value={String(st.drops)} sub={`${st.dropsPerHour.toFixed(1)} per hour`} tone={st.dropsPerHour >= 15 ? 'bad' : st.dropsPerHour >= 5 ? 'warn' : undefined} />
        <Stat label="Avg pulse" value={st.avgPulse != null ? `${Math.round(st.avgPulse)} bpm` : '--'} />
        <Stat label="Pulse range" value={st.minPulse != null ? `${st.minPulse}–${st.maxPulse}` : '--'} sub="lowest – highest" />
      </section>

      <SessionChart session={session} theme={theme} />

      <section className="card">
        <div className="card-title"><span>Time in each oxygen zone</span></div>
        <ZoneBar normal={st.timeNormalSec} bitLow={st.timeBitLowSec} low={st.timeBelow90Sec} />
      </section>

      <section className="card">
        <div className="card-title"><span>What this means</span></div>
        <ul className="insights">
          {list.map((i, k) => (
            <li key={k} className={i.tone}>
              <span className="ins-icon">{toneIcon[i.tone]}</span>
              <div><b>{i.title}</b><p>{i.text}</p></div>
            </li>
          ))}
        </ul>
        <p className="muted small">A “drop” means oxygen fell at least 3 points below your recent level for 10 seconds or more.</p>
      </section>

      <div className="detail-actions">
        <button className="btn ghost" onClick={() => downloadText(fname, sessionToCsv(session))}><IconDownload width={18} height={18} /> Export CSV</button>
        <button className="btn danger-ghost" onClick={() => setConfirm(true)}><IconTrash width={18} height={18} /> Delete</button>
      </div>

      <p className="disclaimer">Not a medical device. These summaries are for personal wellness tracking and are not a diagnosis. Share the CSV with your doctor if you have concerns.</p>

      {confirm ? (
        <div className="sheet-backdrop" onClick={() => setConfirm(false)}>
          <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Delete this night?</h3>
            <p className="muted">It will be removed from this phone. If it is still on your O2 Vibe you can download it again.</p>
            <div className="sheet-actions">
              <button className="btn ghost" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn danger" onClick={onDelete}>Delete</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="stat-label">{label}</span>
      <b className="stat-value">{value}</b>
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </div>
  )
}
