import { PlethWave } from '../components/PlethWave'
import { IconBattery, IconBluetooth, IconDrop, IconHeart, IconSync } from '../components/Icons'
import { Sparkline } from '../components/Sparkline'
import { pulseZone, spo2Zone, validPulse, validSpo2 } from '../lib/analytics'
import { PULSE_STOPS } from '../ui/zones'
import type { DeviceApi } from '../ui/useDevice'
import { ErrorBanner } from '../components/ErrorBanner'

export function LiveView({ dev, btSupported, onOpenHistory }: { dev: DeviceApi; btSupported: boolean; onOpenHistory: () => void }) {
  const connected = dev.status === 'connected' || dev.status === 'reconnecting'
  const r = dev.live
  const spo2 = r?.spo2 ?? null
  const pulse = r?.pulse ?? null
  const sz = spo2Zone(spo2)
  const pz = pulseZone(pulse)
  const fingerOff = connected && r && !r.sensorOn
  const battery = r?.battery ?? dev.info?.battery ?? null

  return (
    <div className="view">
      <ErrorBanner error={dev.error} onClose={dev.dismissError} />

      <section className={`conn-card ${dev.status}`}>
        <div className="conn-row">
          <span className={`status-dot ${dev.status}`} />
          <div className="conn-text">
            <b>
              {dev.status === 'connected' && `Connected${dev.isDemo ? ' (demo)' : ''}`}
              {dev.status === 'reconnecting' && 'Reconnecting…'}
              {dev.status === 'connecting' && 'Connecting…'}
              {(dev.status === 'idle' || dev.status === 'disconnected') && 'Not connected'}
            </b>
            <span>{connected ? dev.name : dev.statusDetail || 'Connect to see live readings and download your nights.'}</span>
          </div>
          {connected && battery != null ? (
            <span className="battery" title="Device battery">
              <IconBattery level={battery} width={22} height={22} /> {battery}%
            </span>
          ) : null}
        </div>
        {connected ? (
          <button className="btn small ghost" onClick={dev.disconnect}>Disconnect</button>
        ) : (
          <div className="conn-actions">
            <button className="btn primary" onClick={() => dev.connect(false)} disabled={dev.status === 'connecting' || !btSupported}>
              <IconBluetooth /> {dev.status === 'disconnected' ? 'Reconnect' : 'Connect'}
            </button>
            <button className="btn ghost" onClick={dev.startDemo}>Demo</button>
          </div>
        )}
        {!connected && btSupported ? (
          <button className="link small" onClick={() => dev.connect(true)}>My device isn’t in the list — show all Bluetooth devices</button>
        ) : null}
      </section>

      {fingerOff ? <div className="hint-card">👆 Put your finger in the sensor — readings appear after a few seconds.</div> : null}

      <section className="tiles">
        <div className={`tile ${connected ? sz.tone : 'none'}`} aria-live="polite">
          <div className="tile-head"><IconDrop width={18} height={18} /> Blood oxygen</div>
          <div className="big-num">
            {connected && spo2 != null ? spo2 : '--'}
            <small>%</small>
          </div>
          <div className="zone-pill">{connected ? sz.label : 'Not connected'}</div>
          <p className="tile-explain">{connected ? sz.explain : 'SpO₂ shows how much oxygen your blood is carrying.'}</p>
        </div>
        <div className={`tile ${connected ? pz.tone : 'none'}`}>
          <div className="tile-head">
            <IconHeart width={18} height={18} className={connected && pulse ? 'beat' : ''} style={pulse ? { animationDuration: `${60 / pulse}s` } : undefined} /> Heart rate
          </div>
          <div className="big-num">
            {connected && pulse != null ? pulse : '--'}
            <small>bpm</small>
          </div>
          <div className="zone-pill">{connected ? pz.label : 'Not connected'}</div>
          <p className="tile-explain">{connected ? pz.explain : 'Beats per minute, measured at your fingertip.'}</p>
        </div>
      </section>

      {connected ? (
        <section className="card">
          <div className="card-title">
            <span>Pulse wave</span>
            {r?.pi != null ? <span className="muted small">Signal strength (PI) {r.pi.toFixed(1)}</span> : null}
          </div>
          {r && r.source !== 'sensors' ? (
            <PlethWave samples={r.pleth} active={!!r.sensorOn} />
          ) : (
            <p className="muted small">This device only sends numbers, not the waveform.</p>
          )}
          {dev.trend.length > 5 ? (
            <>
              <div className="card-title sub"><span>Oxygen, last {Math.max(1, Math.round((dev.trend.length * 1) / 60))} min</span></div>
              <Sparkline values={dev.trend.map((p) => validSpo2(p.spo2))} height={50} min={Math.min(80, ...dev.trend.map((p) => validSpo2(p.spo2) ?? 100).map((v) => Math.floor((v - 2) / 5) * 5))} />
              <div className="card-title sub"><span>Heart rate</span></div>
              <Sparkline values={dev.trend.map((p) => validPulse(p.pulse))} height={44} min={30} max={140} stops={PULSE_STOPS} bands={false} mode="mean" />
            </>
          ) : null}
        </section>
      ) : null}

      {connected ? (
        <section className="card sync-card">
          <div className="card-title"><span>Overnight recordings</span></div>
          <p className="muted">
            {dev.info ? `${dev.info.files.length} recording${dev.info.files.length === 1 ? '' : 's'} on the device.` : 'Reading device…'} Download them to see each night’s summary. Already-saved nights are skipped.
          </p>
          {dev.syncing ? (
            <div className="progress-wrap" aria-live="polite">
              <div className="progress"><span style={{ width: `${dev.syncing.bytesTotal ? (dev.syncing.bytesDone / dev.syncing.bytesTotal) * 100 : 3}%` }} /></div>
              <span className="small muted">
                {dev.syncing.fileCount ? `Night ${dev.syncing.fileIndex + 1} of ${dev.syncing.fileCount}` : 'Checking…'} · {Math.round(dev.syncing.bytesDone / 1024)} / {Math.round(dev.syncing.bytesTotal / 1024)} KB
              </span>
            </div>
          ) : (
            <button className="btn primary wide" onClick={dev.sync} disabled={dev.status !== 'connected'}>
              <IconSync /> Download recordings
            </button>
          )}
          {dev.lastSync ? (
            <div className="sync-result">
              <b>{dev.lastSync.imported ? `${dev.lastSync.imported} new night${dev.lastSync.imported === 1 ? '' : 's'} saved` : 'You’re up to date'}</b>
              {dev.lastSync.skipped ? <span> · {dev.lastSync.skipped} already saved</span> : null}
              {dev.lastSync.failed.length ? <span className="warn-text"> · {dev.lastSync.failed.length} failed ({dev.lastSync.failed[0].error})</span> : null}
              {dev.lastSync.imported || dev.lastSync.skipped ? <button className="link" onClick={onOpenHistory}>See history →</button> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="card legend">
        <div className="card-title"><span>What the colours mean</span></div>
        <div className="legend-row"><i className="dot good" /><b>Green</b><span>Normal: oxygen 95–100%, pulse 50–100</span></div>
        <div className="legend-row"><i className="dot warn" /><b>Amber</b><span>A bit low: oxygen 90–94%, pulse 40–49 or 101–120</span></div>
        <div className="legend-row"><i className="dot low" /><b>Orange-red</b><span>Low oxygen: 88–89%</span></div>
        <div className="legend-row"><i className="dot crit" /><b>Deep red</b><span>Very low oxygen: under 88%, or pulse under 40 / over 120</span></div>
      </section>
      <p className="disclaimer small">Not a medical device. For wellness tracking only.</p>
    </div>
  )
}
