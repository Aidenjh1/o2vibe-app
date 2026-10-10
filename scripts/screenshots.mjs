// Usage: npm run build && npx vite preview --port 4173 & BASE_URL=http://localhost:4173/<base>/ node scripts/screenshots.mjs
// Saves portrait (412x915) and landscape (915x412) demo-mode screenshots to screenshots/v2/.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://localhost:4173/'
const OUT = new URL('../screenshots/v2/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const ua = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
const portrait = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: ua }
const errors = []

async function newPage(scheme = 'light') {
  const ctx = await browser.newContext({ ...portrait, colorScheme: scheme })
  await ctx.addInitScript(() => {
    if (!('bluetooth' in navigator)) Object.defineProperty(navigator, 'bluetooth', { value: { getAvailability: async () => true } })
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(BASE + '?demo=1#/live')
  await page.waitForFunction(() => /\d/.test(document.querySelector('.big-num')?.textContent || ''), null, { timeout: 15000 })
  await page.waitForSelector('.sync-result', { timeout: 30000 })
  return { ctx, page }
}
const settle = (page, ms = 500) => page.waitForTimeout(ms)
const scrollTo = async (page, sel, i = 0) => {
  await page.evaluate(([s, k]) => document.querySelectorAll(s)[k].scrollIntoView({ block: 'start' }), [sel, i])
  await settle(page, 600)
}
async function openLastNight(page) {
  await page.evaluate(() => (location.hash = '/history'))
  await page.waitForSelector('.night-card')
  await page.locator('.night-card').nth(0).click() // newest demo night = the "hypoxic" profile
  await page.waitForSelector('.u-over')
  await settle(page, 800)
}

// ---------- portrait ----------
{
  const { ctx, page } = await newPage()
  await settle(page, 4000)
  await page.screenshot({ path: OUT + 'portrait-01-live.png' })
  await page.evaluate(() => (location.hash = '/history'))
  await page.waitForSelector('.night-card')
  await settle(page)
  await page.screenshot({ path: OUT + 'portrait-02-history.png' })
  await openLastNight(page)
  await page.screenshot({ path: OUT + 'portrait-03-night-warning.png' })
  await page.screenshot({ path: OUT + 'portrait-03-night-full.png', fullPage: true })
  await scrollTo(page, '.chart-screen', 0)
  await page.screenshot({ path: OUT + 'portrait-04-spo2-chart.png' })
  await scrollTo(page, '.chart-screen', 1)
  await page.screenshot({ path: OUT + 'portrait-05-hr-chart.png' })
  // Tap the deepest notable event: the chart zooms to it.
  await scrollTo(page, '.events')
  await page.screenshot({ path: OUT + 'portrait-06-notable-events.png' })
  const idx = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.event')]
    let best = 0
    els.forEach((e, i) => {
      if (parseInt(e.querySelector('.ev-nadir').textContent) < parseInt(els[best].querySelector('.ev-nadir').textContent)) best = i
    })
    return best
  })
  await page.locator('.event').nth(idx).click()
  await settle(page, 1500)
  await page.screenshot({ path: OUT + 'portrait-07-event-zoomed.png' })
  await ctx.close()
}
{
  const { ctx, page } = await newPage('dark')
  await openLastNight(page)
  await page.screenshot({ path: OUT + 'portrait-08-night-warning-dark.png' })
  await scrollTo(page, '.chart-screen', 0)
  await page.screenshot({ path: OUT + 'portrait-09-spo2-chart-dark.png' })
  await ctx.close()
}

// ---------- landscape ----------
{
  const { ctx, page } = await newPage()
  await openLastNight(page)
  await page.setViewportSize({ width: 915, height: 412 })
  await settle(page, 900)
  await page.evaluate(() => window.scrollTo(0, 0))
  await settle(page, 600)
  await page.screenshot({ path: OUT + 'landscape-01-spo2-fullscreen.png' })
  await scrollTo(page, '.chart-screen', 1)
  await page.screenshot({ path: OUT + 'landscape-02-hr-fullscreen.png' })
  await scrollTo(page, '.chart-screen', 0)
  await page.locator('.chart-screen').first().locator('.chart-tools .chip').nth(1).click()
  await settle(page, 300)
  await page.locator('.chart-screen').first().locator('.chart-tools .chip').nth(1).click()
  await settle(page, 600)
  // Scroll sideways to the deepest dip
  await page.evaluate(() => {
    const sc = document.querySelector('.chart-scroll')
    sc.scrollLeft = sc.scrollWidth * 0.66 - sc.clientWidth / 2
  })
  await settle(page, 600)
  await page.screenshot({ path: OUT + 'landscape-03-spo2-zoomed.png' })
  await ctx.close()
}

await browser.close()
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'))
console.log('saved to', OUT)
