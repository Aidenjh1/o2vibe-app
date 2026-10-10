import type { O2Error } from '../ble/transport'

export function ErrorBanner({ error, onClose }: { error: O2Error | null; onClose: () => void }) {
  if (!error) return null
  return (
    <div className="error-banner" role="alert">
      <div>
        <b>{error.message}</b>
        {error.help ? <p>{error.help}</p> : null}
      </div>
      <button className="icon-btn" onClick={onClose} aria-label="Dismiss">✕</button>
    </div>
  )
}
