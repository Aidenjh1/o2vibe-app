import { IconMoon, IconSun } from '../components/Icons'
import type { ThemePref } from '../ui/theme'

export function HelpView({ theme, setTheme, onShowIntro, onClearDemo, demoCount }: { theme: ThemePref; setTheme: (t: ThemePref) => void; onShowIntro: () => void; onClearDemo: () => void; demoCount: number }) {
  return (
    <div className="view help">
      <h2>Help & settings</h2>

      <section className="card">
        <div className="card-title"><span>Appearance</span></div>
        <div className="segmented" role="radiogroup" aria-label="Theme">
          {(['auto', 'light', 'dark'] as ThemePref[]).map((t) => (
            <button key={t} role="radio" aria-checked={theme === t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>
              {t === 'light' ? <IconSun width={16} height={16} /> : t === 'dark' ? <IconMoon width={16} height={16} /> : null}
              {t === 'auto' ? 'Automatic' : t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-title"><span>How to connect</span></div>
        <ol className="plain">
          <li>Turn on Bluetooth on your Pixel. Android may also ask to allow “Nearby devices” for Chrome — say yes.</li>
          <li>Fully close the BodiMetrics (or ViHealth) app: open recent apps and swipe it away. The O2 Vibe only talks to one app at a time.</li>
          <li>Press the button on the O2 Vibe so it’s awake, and keep it close to the phone.</li>
          <li>On the Live tab tap <b>Connect</b>, pick the device starting with “O2”, then tap <b>Pair</b>.</li>
        </ol>
      </section>

      <section className="card">
        <div className="card-title"><span>Downloading your nights</span></div>
        <p>The O2 Vibe saves each recording when you take the sensor off in the morning. Connect, then tap <b>Download recordings</b>. Each night takes a few seconds. Nights you already saved are skipped, so you can sync as often as you like.</p>
      </section>

      <section className="card">
        <div className="card-title"><span>If something goes wrong</span></div>
        <ul className="plain">
          <li><b>Device not in the list:</b> wake it with the button, close the BodiMetrics app, or tap “show all Bluetooth devices”.</li>
          <li><b>Keeps disconnecting:</b> keep the phone within a metre or two; the app reconnects by itself a few times.</li>
          <li><b>“Bluetooth permission blocked”:</b> Chrome ▸ ⋮ ▸ Settings ▸ Site settings ▸ Bluetooth, and Android Settings ▸ Apps ▸ Chrome ▸ Permissions ▸ Nearby devices.</li>
          <li><b>No readings:</b> push your finger fully into the sensor and stay still for 10 seconds.</li>
        </ul>
      </section>

      <section className="card">
        <div className="card-title"><span>Understanding the numbers</span></div>
        <ul className="plain">
          <li><b>SpO₂ (blood oxygen):</b> 95–100% is normal. 90–94% is a bit low. Under 90% is low.</li>
          <li><b>Pulse:</b> 50–100 beats per minute is a normal resting rate; it is often lower while sleeping.</li>
          <li><b>Drops:</b> times oxygen fell 3+ points below your recent level for at least 10 s. Under 5 per hour is generally considered normal.</li>
        </ul>
      </section>

      <section className="card">
        <div className="card-title"><span>Your data</span></div>
        <p>Everything stays on this phone (in Chrome’s storage for this app). Nothing is uploaded. Use Export to share a CSV with your doctor.</p>
        {demoCount ? <button className="btn ghost" onClick={onClearDemo}>Remove {demoCount} demo night{demoCount === 1 ? '' : 's'}</button> : null}
        <button className="link" onClick={onShowIntro}>Show the welcome screen again</button>
      </section>

      <p className="disclaimer">
        <b>Not a medical device.</b> This independent app is not made by or affiliated with BodiMetrics or Viatom. It uses a reverse-engineered Bluetooth protocol and may show incorrect values. It does not diagnose, treat or prevent any disease. Always follow your doctor’s advice.
      </p>
    </div>
  )
}
