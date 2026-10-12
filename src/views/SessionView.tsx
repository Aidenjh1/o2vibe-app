import { useEffect, useState } from 'react'
import type { StoredSession } from '../db/sessions'
import { SessionCharts, type ChartFocus } from '../components/SessionChart'
import { ZoneBar } from '../components/ZoneBar'
import { WarningBanner } from '../components/WarningBanner'
import { IconBack, IconDownload, IconTrash } from '../components/Icons'
import { formatClock, formatDuration, levelTone, odiBand, ratingText, THRESHOLDS as T } from '../lib/analytics'
import { downloadText, sessionToCsv } from '../lib/csv'
import { nightLabel } from './HistoryView'

const toneIcon = { good: '✓', warn: '!', bad: '!!', critical: '!!!', none: 'i' } as const
const LANDSCAPE = '(orientation: landscape) and (max-height: 540px)'

/** In phone landscape (or full screen) the charts take the whole screen; everything else hides. */
function useChartFullMode() {
  useEffect(() => {
    const mq = window.matchMedia(LANDSCAPE)
    const apply = () => document.documentElement.classList.toggle('chart-full', mq.matches || !!document.fullscreenElement)
    apply()
    mq.addEventListener('change', apply)
    document.addEventListener('fullscreenchange', apply)
    return () => {
      mq.removeEventListener('change', apply)
      document.removeEventListener('fullscreenchange', apply)
      document.documentElement.classList.remove('chart-full')
    }
  }, [])
}

export function SessionView({ session, theme, onBack, onDelete }: { session: StoredSession; theme: string; onBack: () => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const [focus, setFocus] = useState<ChartFocus | null>(null)
  const [allEvents, setAllEvents] = useState(false)
  useChartFullMode()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [session.id])

  const st = session.stats
  const { day, date } = nightLabel(session.start)
  const tone = levelTone[st.level]
  const end = session.start + st.durationSec * 1000
  const fname = `o2vibe-${new Date(session.start).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`
  const odi = odiBand(st.dropsPerHour)
  const odi4 = odiBand(st.odi4)
  const events = st.episodes
  // With many events, show the 10 most significant (lowest, then longest) first, in time order.
  const shown = allEvents || events.length <= 10 ? events : [...events].sort((a, b) => a.nadir - b.nadir || b.durationSec - a.durationSec).slice(0, 10).sort((a, b) => a.start - b.start)
  const short = (sec: number) => (sec < 60 ? `${Math.round(sec)}s` : `${Math.round(sec / 60)}m`)
  const nadirTone = st.minSpo2 == null ? undefined : st.minSpo2 < T.nadirVeryLow ? 'critical' : st.minSpo2 < T.nadirLow ? 'bad' : st.minSpo2 < 92 ? 'warn' : undefined
  const pct = (sec: number) => (st.validSec ? `${((sec / st.validSec) * 100).toFixed(1)}% of the night` : undefined)

  return (
    <div className="view detail">
      <div className="detail-head">
        <button className="icon-btn" onClick={onBack} aria-label="Back to history"><IconBack /></button>
        <div>
          <h2>{day} <span className="muted">· {date}</span></h2>
          <div className="muted small">{formatClock(session.start)} – {formatClock(end)} · {formatDuration(st.durationSec)}{session.source === 'demo' ? ' · demo data' : session.source === 'import' ? ' · imported from desktop app' : ''}</div>
        </div>
      </div>

      <WarningBanner stats={st} />

      {st.level < 2 ? (
        <section className={`summary-banner ${tone}`}>
          <b>{ratingText[st.rating]}</b>
          <span>{st.findings[0]?.text}</span>
        </section>
      ) : null}

      <section className="stat-grid">
        <Stat label="Lowest oxygen" value={st.minSpo2 != null ? `${st.minSpo2}%` : '--'} tone={nadirTone} sub={st.minSpo2At ? `at ${formatClock(st.minSpo2At)}` : undefined} />
        <Stat label="Avg oxygen" value={st.avgSpo2 != null ? `${st.avgSpo2.toFixed(0)}%` : '--'} tone={st.avgSpo2 != null && st.avgSpo2 < T.avgCrit ? 'critical' : st.avgSpo2 != null && st.avgSpo2 < T.avgBad ? 'bad' : st.avgSpo2 != null && st.avgSpo2 < T.avgWarn ? 'warn' : undefined} />
        <Stat label="Under 90% (T90)" value={formatDuration(st.timeBelow90Sec)} sub={pct(st.timeBelow90Sec)} tone={st.timeBelow90Sec >= 60 ? 'bad' : st.timeBelow90Sec > 0 ? 'warn' : undefined} />
        <Stat label="Under 88% (T88)" value={formatDuration(st.timeBelow88Sec)} sub={pct(st.timeBelow88Sec)} tone={st.timeBelow88Sec >= T.t88CritMin * 60 ? 'critical' : st.timeBelow88Sec > 0 ? 'bad' : undefined} />
        <Stat label="Under 85% / 80%" value={`${short(st.timeBelow85Sec)} / ${short(st.timeBelow80Sec)}`} sub={`${formatDuration(st.timeBelow85Sec)} / ${formatDuration(st.timeBelow80Sec)}`} tone={st.timeBelow85Sec >= 60 ? 'critical' : st.timeBelow85Sec > 0 ? 'bad' : undefined} />
        <Stat label="Longest under 90%" value={formatDuration(st.longestBelow90Sec)} sub={`${st.episodesBelow90} episode${st.episodesBelow90 === 1 ? '' : 's'}${st.longestBelow88Sec ? ` · under 88% ${formatDuration(st.longestBelow88Sec)}` : ''}`} tone={st.longestBelow90Sec >= T.longest90CritMin * 60 ? 'critical' : st.longestBelow90Sec >= T.longest90BadMin * 60 ? 'bad' : undefined} />
        <Stat label="Drops ≥3% (ODI)" value={`${st.dropsPerHour.toFixed(1)}/h`} sub={`${st.drops} drops · ${odi.label}`} tone={odi.level ? (levelTone[odi.level] as StatTone) : undefined} />
        <Stat label="Drops ≥4% (ODI-4)" value={`${st.odi4.toFixed(1)}/h`} sub={`${st.drops4} drops · ${odi4.label}`} tone={odi4.level ? (levelTone[odi4.level] as StatTone) : undefined} />
        <Stat label="Avg pulse" value={st.avgPulse != null ? `${Math.round(st.avgPulse)} bpm` : '--'} tone={st.avgPulse != null && st.avgPulse < T.hrBradyAvg ? 'warn' : undefined} sub={st.timePulseBelow50Sec ? `${formatDuration(st.timePulseBelow50Sec)} under 50` : undefined} />
        <Stat label="Pulse range" value={st.minPulse != null ? `${st.minPulse}–${st.maxPulse}` : '--'} sub={st.timePulseAbove100Sec ? `${formatDuration(st.timePulseAbove100Sec)} over 100` : 'lowest – highest'} tone={(st.minPulse != null && st.minPulse < T.hrVeryLow) || (st.maxPulse != null && st.maxPulse > T.hrVeryHigh) ? 'bad' : st.minPulse != null && st.minPulse < 50 ? 'warn' : undefined} />
        {st.pctBadSignal >= 1 ? (
          <Stat label="No / bad signal" value={formatDuration(st.badSignalSec)} sub={`${st.pctBadSignal.toFixed(0)}% of the recording ignored`} tone={st.pctBadSignal >= T.badSignalWarnPct ? 'warn' : undefined} />
        ) : null}
      </section>

      <SessionCharts session={session} theme={theme} focus={focus} />

      <section className="card">
        <div className="card-title"><span>Notable events</span><span className="muted small">{events.length ? `${events.length} time${events.length === 1 ? '' : 's'} under 90%` : ''}</span></div>
        {events.length ? (
          <>
            <ul className="events">
              {shown.map((e, k) => (
                <li key={k}>
                  <button className={`event ${e.nadir < 85 ? 'critical' : e.nadir < 88 ? 'bad' : 'low'}`} onClick={() => setFocus({ start: e.start, end: e.end, nonce: Date.now() })}>
                    <span className="ev-time">{formatClock(e.start)}</span>
                    <span className="ev-desc">Under 90% for <b>{formatDuration(e.durationSec)}</b></span>
                    <span className="ev-nadir">{e.nadir}%</span>
                  </button>
                </li>
              ))}
            </ul>
            {events.length > 10 ? (
              <button className="btn ghost small" onClick={() => setAllEvents(!allEvents)}>{allEvents ? 'Show the 10 most significant' : `Show all ${events.length}`}</button>
            ) : null}
            <p className="muted small">{!allEvents && events.length > 10 ? 'Showing the 10 lowest. ' : ''}Tap an event to zoom the chart to it.</p>
          </>
        ) : (
          <p className="muted">Oxygen did not stay under 90% at any point this night.</p>
        )}
      </section>

      <section className="card">
        <div className="card-title"><span>Time in each oxygen zone</span></div>
        <ZoneBar normal={st.timeNormalSec} bitLow={st.timeBitLowSec} low={st.timeLowSec} veryLow={st.timeVeryLowSec} />
      </section>

      {session.notes ? (
        <section className="card notes-card">
          <div className="card-title"><span>Your notes</span></div>
          <p>{session.notes}</p>
        </section>
      ) : null}

      <section className="card">
        <div className="card-title"><span>What this means</span></div>
        <ul className="insights">
          {st.findings.map((i, k) => {
            const t = i.level == null ? 'none' : levelTone[i.level]
            return (
              <li key={k} className={t}>
                <span className="ins-icon">{toneIcon[t]}</span>
                <div><b>{i.title}</b><p>{i.text}</p></div>
              </li>
            )
          })}
        </ul>
        <p className="muted small">A “drop” (ODI) means oxygen fell at least 3 points (or 4 for ODI-4) below your recent level for 10 seconds or more. Under 5 per hour is normal, 5–15 mild, 15–30 moderate, over 30 severe. Readings of 0, 255, out of range or with the sensor off are ignored.</p>
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

type StatTone = 'warn' | 'bad' | 'critical'

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: StatTone | 'good' | 'none' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="stat-label">{label}</span>
      <b className="stat-value">{value}</b>
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </div>
  )
}
