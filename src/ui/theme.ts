import { useEffect, useState } from 'react'

export type ThemePref = 'auto' | 'light' | 'dark'

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => (localStorage.getItem('o2.theme') as ThemePref) || 'auto')
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const h = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  const resolved = pref === 'auto' ? (systemDark ? 'dark' : 'light') : pref
  useEffect(() => {
    document.documentElement.dataset.theme = resolved
    localStorage.setItem('o2.theme', pref)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#0b1220' : '#f6f8fb')
  }, [pref, resolved])
  return { pref, setPref, resolved }
}

/** Read a CSS custom property (for canvas/uPlot colours). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
