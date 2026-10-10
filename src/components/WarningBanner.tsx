import type { SessionStats } from '../lib/analytics'
import { warningSummary } from '../lib/analytics'

/** Strong red banner shown whenever a night meets a "low" (level 2) or "very low" (level 3) criterion. */
export function WarningBanner({ stats }: { stats: SessionStats }) {
  const w = warningSummary(stats)
  if (!w) return null
  return (
    <section className={`warn-banner ${w.level === 3 ? 'critical' : 'bad'}`} role="alert">
      <div className="warn-head">
        <span className="warn-icon" aria-hidden="true">⚠</span>
        <b>{w.headline}</b>
      </div>
      {w.facts.length ? (
        <ul className="warn-facts">
          {w.facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : null}
      <p>{w.advice}</p>
      <p className="warn-note">O2 Vibe Pro is not a medical device and this is not a diagnosis. Finger sensors can also read low if the ring slips or your hand is cold, so a doctor can confirm with a proper test.</p>
    </section>
  )
}
