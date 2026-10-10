import { DEVICE_INFO_SERVICE, DEVICE_NAME_PREFIXES, O2_NOTIFY_UUID, O2_SERVICE_UUID, O2_WRITE_UUID, OXYII_SERVICE_UUID } from '../lib/viatom/constants'
import { chunk } from '../lib/viatom/packet'
import { checkWebBluetoothSupport, mapBluetoothError, O2Error, type Transport } from './transport'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class WebBluetoothTransport implements Transport {
  readonly kind = 'ble' as const
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null
  private notifyChar: BluetoothRemoteGATTCharacteristic | null = null
  private dataCb: (b: Uint8Array) => void = () => {}
  private discCb: () => void = () => {}
  private withoutResponse = true

  private constructor(private readonly device: BluetoothDevice) {
    device.addEventListener('gattserverdisconnected', () => {
      this.writeChar = null
      this.notifyChar = null
      this.discCb()
    })
  }

  get name(): string {
    return this.device.name || 'O2 device'
  }

  get connected(): boolean {
    return !!this.device.gatt?.connected && !!this.writeChar
  }

  /** Show Chrome's device chooser and connect. */
  static async request(showAll = false): Promise<WebBluetoothTransport> {
    const unsupported = checkWebBluetoothSupport()
    if (unsupported) throw unsupported
    const bt = navigator.bluetooth
    if (bt.getAvailability && !(await bt.getAvailability().catch(() => true))) {
      throw new O2Error('bluetooth_off', 'Bluetooth is turned off (or this phone has no Bluetooth).', 'Turn on Bluetooth in quick settings, then tap Connect again.')
    }
    let device: BluetoothDevice
    try {
      const optionalServices = [O2_SERVICE_UUID, OXYII_SERVICE_UUID, DEVICE_INFO_SERVICE]
      device = await bt.requestDevice(
        showAll
          ? { acceptAllDevices: true, optionalServices }
          : {
              filters: [{ services: [O2_SERVICE_UUID] }, ...DEVICE_NAME_PREFIXES.map((namePrefix) => ({ namePrefix }))],
              optionalServices,
            },
      )
    } catch (e) {
      throw mapBluetoothError(e)
    }
    const t = new WebBluetoothTransport(device)
    await t.open()
    return t
  }

  /** Reconnect to a device the user already granted (Chrome "getDevices", when available). */
  static async fromRemembered(): Promise<WebBluetoothTransport | null> {
    const bt = typeof navigator !== 'undefined' ? navigator.bluetooth : undefined
    if (!bt || typeof bt.getDevices !== 'function') return null
    const devices = await bt.getDevices().catch(() => [] as BluetoothDevice[])
    const last = localStorage.getItem('o2.lastDeviceId')
    const d = devices.find((x) => x.id === last) ?? null
    if (!d) return null
    const t = new WebBluetoothTransport(d)
    await t.open()
    return t
  }

  private async open(attempts = 3): Promise<void> {
    let lastErr: unknown
    for (let i = 0; i < attempts; i++) {
      try {
        const server = await this.device.gatt!.connect()
        let service: BluetoothRemoteGATTService
        try {
          service = await server.getPrimaryService(O2_SERVICE_UUID)
        } catch {
          const hasNew = await server.getPrimaryService(OXYII_SERVICE_UUID).then(() => true, () => false)
          server.disconnect()
          if (hasNew) {
            throw new O2Error('newer_protocol', 'This oximeter uses Viatom’s newer “OxyII” protocol, which this app cannot read yet.', 'Your device connected fine but speaks a different, encrypted protocol (used by O2Ring S). Please report the device name shown in the list.')
          }
          throw new O2Error('wrong_device', 'That device is not a supported oximeter.', 'Pick the device whose name starts with “O2” (for example “O2 Vibe 1234”).')
        }
        this.writeChar = await service.getCharacteristic(O2_WRITE_UUID)
        this.notifyChar = await service.getCharacteristic(O2_NOTIFY_UUID)
        this.withoutResponse = this.writeChar.properties.writeWithoutResponse
        this.notifyChar.addEventListener('characteristicvaluechanged', this.onValue)
        await this.notifyChar.startNotifications()
        localStorage.setItem('o2.lastDeviceId', this.device.id)
        return
      } catch (e) {
        if (e instanceof O2Error) throw e
        lastErr = e
        await sleep(600 * (i + 1))
      }
    }
    throw mapBluetoothError(lastErr)
  }

  private onValue = (ev: Event) => {
    const v = (ev.target as BluetoothRemoteGATTCharacteristic).value
    if (v) this.dataCb(new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)))
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.writeChar) throw new O2Error('disconnected', 'The device is not connected.')
    for (const part of chunk(bytes)) {
      const buf = part.slice().buffer as ArrayBuffer
      try {
        if (this.withoutResponse) await this.writeChar.writeValueWithoutResponse(buf)
        else await this.writeChar.writeValueWithResponse(buf)
      } catch (e) {
        throw mapBluetoothError(e)
      }
    }
  }

  onData(cb: (bytes: Uint8Array) => void): void {
    this.dataCb = cb
  }

  onDisconnect(cb: () => void): void {
    this.discCb = cb
  }

  async reconnect(): Promise<void> {
    if (this.notifyChar) this.notifyChar.removeEventListener('characteristicvaluechanged', this.onValue)
    await this.open(2)
  }

  disconnect(): void {
    try {
      this.device.gatt?.disconnect()
    } catch {
      /* ignore */
    }
  }
}
