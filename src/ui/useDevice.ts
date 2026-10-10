import { useCallback, useEffect, useRef, useState } from 'react'
import { O2Client, type LinkState } from '../ble/client'
import { syncRecordings, type SyncProgress, type SyncResult } from '../ble/sync'
import { O2Error } from '../ble/transport'
import { WebBluetoothTransport } from '../ble/webBluetooth'
import { FakeO2Device } from '../demo/fakeDevice'
import type { DeviceInfo } from '../lib/viatom/info'
import type { LiveReading } from '../lib/viatom/live'

export type Status = 'idle' | 'connecting' | LinkState

export interface TrendPoint {
  t: number
  spo2: number | null
  pulse: number | null
}

export interface DeviceState {
  status: Status
  statusDetail?: string
  isDemo: boolean
  name?: string
  info: DeviceInfo | null
  live: LiveReading | null
  trend: TrendPoint[]
  error: O2Error | null
  syncing: SyncProgress | null
  lastSync: SyncResult | null
}

const initial: DeviceState = { status: 'idle', isDemo: false, info: null, live: null, trend: [], error: null, syncing: null, lastSync: null }

export function useDevice(onSessionsChanged: () => void) {
  const [st, setSt] = useState<DeviceState>(initial)
  const clientRef = useRef<O2Client | null>(null)
  const patch = useCallback((p: Partial<DeviceState>) => setSt((s) => ({ ...s, ...p })), [])

  const attach = useCallback(
    async (client: O2Client, isDemo: boolean) => {
      const old = clientRef.current
      clientRef.current = client
      old?.disconnect()
      patch({ status: 'connected', isDemo, name: client.name, error: null, live: null, trend: [], lastSync: null })
      try {
        const info = await client.init()
        patch({ info })
      } catch (e) {
        patch({ error: e instanceof O2Error ? e : new O2Error('protocol', (e as Error).message, 'Try disconnecting and connecting again.') })
      }
      client.startLive(1000)
    },
    [patch],
  )

  const makeClient = useCallback(
    (t: ConstructorParameters<typeof O2Client>[0]) =>
      new O2Client(t, {
        onLive: (r) =>
          setSt((s) => {
            if (clientRefOk(t)) {
              const trend = [...s.trend, { t: r.at, spo2: r.spo2, pulse: r.pulse }].slice(-300)
              return { ...s, live: r, trend }
            }
            return s
          }),
        onState: (state, detail) => {
          if (!clientRefOk(t)) return
          setSt((s) => ({ ...s, status: state, statusDetail: detail, live: state === 'connected' ? s.live : null }))
        },
        onLog: (l) => console.debug('[o2]', l),
      }),
    [],
  )
  const clientRefOk = (t: unknown) => clientRef.current?.transport === t

  const connect = useCallback(
    async (showAll = false) => {
      patch({ status: 'connecting', error: null, statusDetail: undefined })
      try {
        const t = await WebBluetoothTransport.request(showAll)
        await attach(makeClient(t), false)
      } catch (e) {
        const err = e instanceof O2Error ? e : new O2Error('unknown', (e as Error).message)
        patch({ status: 'idle', error: err.code === 'cancelled' ? null : err })
        if (err.code === 'cancelled') patch({ statusDetail: err.help })
      }
    },
    [attach, makeClient, patch],
  )

  const startDemo = useCallback(async () => {
    const dev = new FakeO2Device()
    dev.latencyMs = 2
    await attach(makeClient(dev), true)
  }, [attach, makeClient])

  const disconnect = useCallback(() => {
    const c = clientRef.current
    clientRef.current = null
    c?.disconnect()
    setSt({ ...initial })
  }, [])

  const sync = useCallback(async () => {
    const c = clientRef.current
    if (!c) return
    patch({ syncing: { fileIndex: 0, fileCount: 0, fileName: '', bytesDone: 0, bytesTotal: 0 }, error: null })
    try {
      const res = await syncRecordings(c, (p) => patch({ syncing: p }))
      patch({ lastSync: res, syncing: null })
      onSessionsChanged()
    } catch (e) {
      patch({ syncing: null, error: e instanceof O2Error ? e : new O2Error('protocol', (e as Error).message) })
    }
  }, [onSessionsChanged, patch])

  const dismissError = useCallback(() => patch({ error: null }), [patch])

  useEffect(() => () => clientRef.current?.disconnect(), [])

  return { ...st, connect, startDemo, disconnect, sync, dismissError }
}

export type DeviceApi = ReturnType<typeof useDevice>
