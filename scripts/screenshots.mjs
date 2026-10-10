// Usage: npm run build && npx vite preview --port 4173 & node scripts/screenshots.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://localhost:4173/'
const OUT = new URL('../screenshots/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const device = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' }

async function shoot(scheme) {
  const ctx = await browser.newContext({ ...device, colorScheme: scheme })
  // Headless Chrome has no Bluetooth adapter; pretend the API exists so the onboarding
  // screen looks like it does in Chrome on a phone (demo mode never touches it).
  await ctx.addInitScript(() => {
    if (!('bluetooth' in navigator)) Object.defineProperty(navigator, 'bluetooth', { value: { getAvailability: async () => true } })
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error('pageerror', e))
  const sfx = scheme === 'dark' ? '-dark' : ''

  if (scheme === 'light') {
    await page.goto(BASE)
    await page.waitForSelector('.onboard')
    await page.screenshot({ path: OUT + '01-onboarding.png' })
    await page.screenshot({ path: OUT + '01-onboarding-full.png', fullPage: true })
  }

  await page.goto(BASE + '?demo=1#/live')
  await page.waitForFunction(() => /\d/.test(document.querySelector('.big-num')?.textContent || ''), null, { timeout: 15000 })
  await page.waitForSelector('.sync-result', { timeout: 30000 })
  await page.waitForTimeout(3500)
  await page.screenshot({ path: OUT + `02-live-demo${sfx}.png` })
  if (scheme === 'light') await page.screenshot({ path: OUT + '02-live-demo-full.png', fullPage: true })

  await page.evaluate(() => (location.hash = '/history'))
  await page.waitForSelector('.night-card')
  await page.waitForTimeout(400)
  await page.screenshot({ path: OUT + `03-history${sfx}.png` })
  if (scheme === 'light') await page.screenshot({ path: OUT + '03-history-full.png', fullPage: true })

  // Open a night with a few dips (the 2nd newest demo night uses the "mild" profile).
  const cards = page.locator('.night-card')
  await cards.nth(1).click()
  await page.waitForSelector('.u-over')
  await page.waitForTimeout(600)
  await page.screenshot({ path: OUT + `04-session-detail${sfx}.png` })
  if (scheme === 'light') {
    await page.screenshot({ path: OUT + '04-session-detail-full.png', fullPage: true })
    // Zoomed chart
    await page.locator('.chart-tools .chip').first().click()
    await page.locator('.chart-tools .chip').first().click()
    await page.waitForTimeout(300)
    const chart = page.locator('.chart-card')
    await chart.scrollIntoViewIfNeeded()
    await chart.screenshot({ path: OUT + '05-chart-zoomed.png' })
    // A rougher night (the "moderate" demo profile is 4th newest).
    await page.evaluate(() => (location.hash = '/history'))
    await page.locator('.night-card').nth(3).click()
    await page.waitForSelector('.u-over')
    await page.waitForTimeout(500)
    await page.screenshot({ path: OUT + '07-session-detail-rough-night-full.png', fullPage: true })
    await page.evaluate(() => (location.hash = '/help'))
    await page.waitForSelector('.help')
    await page.screenshot({ path: OUT + '06-help.png' })
  }
  await ctx.close()
}

await shoot('light')
await shoot('dark')
await browser.close()
console.log('saved to', OUT)
