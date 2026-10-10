import { useCallback, useEffect, useMemo, useState } from 'react'
import { deleteBySource, deleteSession, listSessions, type StoredSession } from './db/sessions'
import { checkWebBluetoothSupport } from './ble/transport'
import { useDevice } from './ui/useDevice'
import { useTheme } from './ui/theme'
import { Onboarding } from './views/Onboarding'
import { LiveView } from './views/LiveView'
import { HistoryView } from './views/HistoryView'
import { SessionView } from './views/SessionView'
import { HelpView } from './views/HelpView'
import { IconHelp, IconHistory, IconLive } from './components/Icons'

type Route = { name: 'live' } | { name: 'history' } | { name: 'help' } | { name: 'session'; id: string }

function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, '')
  if (h.startsWith('session/')) return { name: 'session', id: decodeURIComponent(h.slice(8)) }
  if (h === 'history' || h === 'help') return { name: h }
  return { name: 'live' }
}
const go = (path: string) => {
  if (location.hash !== '#/' + path) location.hash = '/' + path
}

export default function App() {
  const theme = useTheme()
  const [route, setRoute] = useState<Route>(parseHash)
  const [sessions, setSessions] = useState<StoredSession[]>([])
  const [loaded, setLoaded] = useState(false)
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem('o2.onboarded') === '1')
  const btError = useMemo(() => checkWebBluetoothSupport(), [])

  const refresh = useCallback(async () => {
    setSessions(await listSessions())
    setLoaded(true)
  }, [])
  const dev = useDevice(refresh)

  useEffect(() => {
    void refresh()
    const h = () => {
      setRoute(parseHash())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [refresh])

  const finishOnboarding = () => {
    localStorage.setItem('o2.onboarded', '1')
    setOnboarded(true)
  }

  // ?demo=1 starts demo mode straight away (handy for trying the app or taking screenshots).
  const { startDemo, sync } = dev
  useEffect(() => {
    if (new URLSearchParams(location.search).get('demo') === '1') {
      finishOnboarding()
      void startDemo()
    }
  }, [startDemo])

  const loadDemo = async () => {
    finishOnboarding()
    await startDemo()
    go('live')
  }
  const connect = async () => {
    finishOnboarding()
    go('live')
    await dev.connect(false)
  }

  // In demo mode, pull the demo nights automatically the first time so History isn't empty.
  useEffect(() => {
    if (dev.isDemo && dev.info && !dev.lastSync && !dev.syncing) void sync()
  }, [dev.isDemo, dev.info, dev.lastSync, dev.syncing, sync])

  if (!onboarded) {
    return (
      <main className="app">
        <Onboarding btSupported={!btError} onConnect={connect} onDemo={loadDemo} onSkip={finishOnboarding} />
      </main>
    )
  }

  const session = route.name === 'session' ? sessions.find((s) => s.id === route.id) : undefined
  const tab = route.name === 'session' ? 'history' : route.name

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" />O2 Vibe</div>
        {dev.status === 'connected' || dev.status === 'reconnecting' ? (
          <span className={`top-status ${dev.status}`}><span className={`status-dot ${dev.status}`} />{dev.isDemo ? 'Demo' : dev.status === 'connected' ? 'Connected' : 'Reconnecting'}</span>
        ) : null}
      </header>
      <main className="content">
        {route.name === 'live' && <LiveView dev={dev} btSupported={!btError} onOpenHistory={() => go('history')} />}
        {route.name === 'history' && loaded && (
          <HistoryView sessions={sessions} onOpen={(id) => go('session/' + encodeURIComponent(id))} onConnect={connect} onDemo={loadDemo} connected={dev.status === 'connected'} />
        )}
        {route.name === 'session' &&
          (session ? (
            <SessionView
              session={session}
              theme={theme.resolved}
              onBack={() => history.length > 1 ? history.back() : go('history')}
              onDelete={async () => {
                await deleteSession(session.id)
                await refresh()
                go('history')
              }}
            />
          ) : loaded ? (
            <div className="view empty"><h2>Night not found</h2><button className="btn ghost" onClick={() => go('history')}>Back to history</button></div>
          ) : null)}
        {route.name === 'help' && (
          <HelpView
            theme={theme.pref}
            setTheme={theme.setPref}
            demoCount={sessions.filter((s) => s.source === 'demo').length}
            onClearDemo={async () => {
              await deleteBySource('demo')
              await refresh()
            }}
            onShowIntro={() => {
              localStorage.removeItem('o2.onboarded')
              setOnboarded(false)
            }}
          />
        )}
      </main>
      <nav className="tabbar" aria-label="Main">
        <button className={tab === 'live' ? 'on' : ''} onClick={() => go('live')}><IconLive /><span>Live</span></button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => go('history')}>
          <IconHistory /><span>History</span>{sessions.length ? <em className="badge">{sessions.length}</em> : null}
        </button>
        <button className={tab === 'help' ? 'on' : ''} onClick={() => go('help')}><IconHelp /><span>Help</span></button>
      </nav>
    </div>
  )
}
