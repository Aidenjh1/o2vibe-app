import { IconBluetooth, IconDrop, IconHeart } from '../components/Icons'

export function Onboarding({ onConnect, onDemo, onSkip, btSupported }: { onConnect: () => void; onDemo: () => void; onSkip: () => void; btSupported: boolean }) {
  return (
    <div className="onboard">
      <div className="onboard-hero">
        <div className="hero-badges">
          <span className="hero-badge spo2"><IconDrop width={28} height={28} /></span>
          <span className="hero-badge pulse"><IconHeart width={28} height={28} /></span>
        </div>
        <h1>Your oxygen and heart rate, made simple</h1>
        <p className="lead">This app reads your BodiMetrics O2 Vibe over Bluetooth and explains the numbers in plain English.</p>
      </div>

      <ol className="steps">
        <li>
          <b>Put on the O2 Vibe</b>
          <span>Wrist unit on, finger sensor snug. Press the button so the screen lights up.</span>
        </li>
        <li>
          <b>Close the BodiMetrics app</b>
          <span>The O2 Vibe can only talk to one app at a time.</span>
        </li>
        <li>
          <b>Tap “Connect” and pick your device</b>
          <span>Choose the name starting with “O2” in the Bluetooth list, then tap Pair.</span>
        </li>
      </ol>

      <div className="legend-card">
        <div className="legend-row"><i className="dot good" /><b>95–100%</b><span>Normal</span></div>
        <div className="legend-row"><i className="dot warn" /><b>90–94%</b><span>A bit low</span></div>
        <div className="legend-row"><i className="dot bad" /><b>Under 90%</b><span>Low</span></div>
      </div>

      <div className="onboard-actions">
        <button className="btn primary big" onClick={onConnect} disabled={!btSupported}>
          <IconBluetooth /> Connect my O2 Vibe
        </button>
        {!btSupported ? <p className="note warn-text">Bluetooth isn’t available in this browser. Open this page in Chrome on your Pixel over https://.</p> : null}
        <button className="btn ghost big" onClick={onDemo}>Try it with demo data</button>
        <button className="link" onClick={onSkip}>Skip for now</button>
      </div>

      <p className="disclaimer">
        <b>Not a medical device.</b> This app is for personal wellness tracking only. It does not diagnose or treat any condition. If you feel unwell, or readings worry you, contact a doctor. In an emergency call 911.
      </p>
    </div>
  )
}
