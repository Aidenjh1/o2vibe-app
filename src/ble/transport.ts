/** A byte pipe to an O2 device. Implemented by Web Bluetooth and by the demo simulator. */
export interface Transport {
  readonly name: string
  readonly kind: 'ble' | 'demo'
  write(bytes: Uint8Array): Promise<void>
  /** Register the notification handler (raw notification payloads). */
  onData(cb: (bytes: Uint8Array) => void): void
  /** Called when the link drops for any reason. */
  onDisconnect(cb: () => void): void
  /** Try to re-establish the link to the same device. */
  reconnect(): Promise<void>
  disconnect(): void
  readonly connected: boolean
}

export type O2ErrorCode =
  | 'unsupported_browser'
  | 'insecure_context'
  | 'bluetooth_off'
  | 'permission_denied'
  | 'cancelled'
  | 'connect_failed'
  | 'wrong_device'
  | 'newer_protocol'
  | 'timeout'
  | 'protocol'
  | 'disconnected'
  | 'unknown'

export class O2Error extends Error {
  constructor(
    public readonly code: O2ErrorCode,
    message: string,
    /** Plain-language fix suggestion for the UI. */
    public readonly help?: string,
  ) {
    super(message)
    this.name = 'O2Error'
  }
}

/** Map a DOMException from Web Bluetooth into a friendly error. */
export function mapBluetoothError(err: unknown): O2Error {
  if (err instanceof O2Error) return err
  const name = typeof err === 'object' && err && 'name' in err ? String((err as { name: unknown }).name) : ''
  const msg = err instanceof Error ? err.message : String(err)
  switch (name) {
    case 'NotFoundError':
      if (/cancel/i.test(msg) || /chooser/i.test(msg)) {
        return new O2Error('cancelled', 'No device was picked.', 'Tap Connect again and choose your O2 Vibe from the list.')
      }
      if (/adapter|bluetooth.*(off|disabled|not available)/i.test(msg)) {
        return new O2Error('bluetooth_off', 'Bluetooth seems to be turned off.', 'Swipe down from the top of your phone and turn on Bluetooth (and Location if asked), then try again.')
      }
      return new O2Error('cancelled', 'No device was picked.', 'If your O2 Vibe was not in the list: press its button to wake it, keep it close, and make sure the BodiMetrics app is closed.')
    case 'SecurityError':
    case 'NotAllowedError':
      return new O2Error('permission_denied', 'Bluetooth permission was blocked.', 'Open Chrome ▸ Settings ▸ Site settings ▸ Bluetooth (and Android Settings ▸ Apps ▸ Chrome ▸ Permissions ▸ Nearby devices) and allow it for this site.')
    case 'NetworkError':
      return new O2Error('connect_failed', 'Could not connect to the device.', 'Keep the O2 Vibe within a metre, press its button to wake it, and fully close the BodiMetrics/ViHealth app — the device only talks to one app at a time.')
    case 'NotSupportedError':
      return new O2Error('wrong_device', 'This device does not offer the expected oximeter service.', 'Make sure you picked the O2 Vibe in the list.')
    case 'InvalidStateError':
      return new O2Error('bluetooth_off', 'Bluetooth is not ready.', 'Turn Bluetooth on and try again.')
    default:
      return new O2Error('unknown', msg || 'Something went wrong with Bluetooth.')
  }
}

export function checkWebBluetoothSupport(): O2Error | null {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return new O2Error('insecure_context', 'Bluetooth needs a secure (https://) page.', 'Open the app from its https:// address (see README) instead of http://.')
  }
  if (typeof navigator === 'undefined' || !('bluetooth' in navigator)) {
    return new O2Error('unsupported_browser', 'This browser cannot use Bluetooth.', 'Open this page in Google Chrome on your Pixel (not Firefox, Samsung Internet or an in-app browser).')
  }
  return null
}
