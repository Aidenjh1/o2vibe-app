# O2 Vibe Companion (PWA)

A small, installable web app for a **BodiMetrics O2 Vibe** wrist pulse oximeter (made by Viatom / Wellue,
same family as the O2Ring, Checkme O2 and SleepU). Open it in Chrome on an Android phone (built and tested
with a Google Pixel in mind), add it to your home screen, and it:

- connects to the O2 Vibe over **Web Bluetooth** — no Play Store, no account, no cloud;
- shows **live blood oxygen (SpO₂), pulse and the pulse waveform** in big, colour-coded tiles with plain-English explanations;
- **downloads the overnight recordings** stored on the device and keeps them on the phone (IndexedDB);
- shows a **history of nights** (avg / lowest SpO₂, time under 90%, number of oxygen drops, pulse avg / range, duration);
- opens each night with a **red warning banner** whenever oxygen went low, then **separate, full-screen-tall SpO₂ and heart-rate charts** (zone-coloured lines, swipe sideways, pinch / ± to zoom, synced time axes; rotate to landscape for full-screen charts), a tappable **Notable events** list and “What this means” findings;
- exports CSV (one night, or a summary of all nights), deletes nights, light / dark / automatic theme;
- includes a **demo mode** with a realistic simulated device, so you can try everything without the hardware.

> **Not a medical device.** For personal wellness tracking only. It does not diagnose or treat anything,
> it isn't affiliated with BodiMetrics or Viatom, and it uses a reverse-engineered protocol, so values could be wrong.

Live site: <https://aidenjh1.github.io/o2vibe-app/> (once GitHub Pages is enabled). Screenshots can be regenerated with `npm run screenshots` (not committed).

## Zones used in the app

| SpO₂ | Label | | Pulse (resting) | Label |
|---|---|---|---|---|
| 95–100 % | Normal (green) | | 50–100 bpm | Normal |
| 90–94 % | A bit low (amber) | | 40–49 / 101–120 | Slow / Fast (amber) |
| 88–89 % | Low (orange-red) | | < 40 / > 120 | Very slow / very fast (red) |
| < 88 % | Very low (deep red) | | | |

See **How a night is rated (v2)** below for the night rating and warning thresholds.

## Install on a Google Pixel

1. Put the app on an **https://** address (see *Deploy* below). Web Bluetooth only works on secure pages
   (`https://` or `http://localhost`).
2. Open that address in **Chrome** on the Pixel (not Firefox / Samsung Internet / an in-app browser).
3. Tap **⋮ → Add to Home screen → Install** (Chrome may also show an “Install app” banner).
4. Open **O2 Vibe** from the home screen. It runs full-screen and works offline after the first load.

## Connect the O2 Vibe

1. Turn on Bluetooth. The first time, Android may ask to allow **Nearby devices** for Chrome — allow it.
2. **Fully close the BodiMetrics app** (swipe it away in recent apps). The device only accepts one connection.
3. Press the O2 Vibe’s button so it is awake; keep it near the phone.
4. In the app tap **Connect**, choose the device whose name starts with **“O2”**, tap **Pair**.
   If it isn’t listed, tap *“My device isn’t in the list — show all Bluetooth devices”*.
5. Live readings appear within a few seconds. Tap **Download recordings** to pull the stored nights;
   nights already saved are skipped (deduplicated by device serial + file name, and by start time + length).

If the link drops, the app retries automatically (0.5 s → 12 s back-off) and shows *Reconnecting…*.
Errors are explained in plain language (Bluetooth off, permission blocked, unsupported browser, not https,
wrong device, newer-protocol device).

## Develop / build

```bash
npm install
npm run dev          # http://localhost:5173 (localhost counts as secure, so Web Bluetooth works on desktop Chrome)
npm test             # vitest: protocol framing / CRC / reassembly / live + file parsing / client / analytics / storage
npm run build        # static site in dist/
npx vite preview     # serve dist/ on http://localhost:4173
npm run screenshots  # (with preview running) Playwright screenshots → screenshots/
```

Append `?demo=1` to the URL to start demo mode immediately.

Stack: Vite + React + TypeScript, `uplot` (≈ 50 KB) for charts, `idb` for IndexedDB, `vite-plugin-pwa`
(Workbox) for the manifest + service worker. The production bundle is ~115 KB gzipped.

### Code map

| Path | What |
|---|---|
| `src/lib/viatom/constants.ts` | UUIDs, opcodes, name prefixes |
| `src/lib/viatom/crc.ts` | CRC-8 (poly 0x07) |
| `src/lib/viatom/packet.ts` | frame builder/parser, 20-byte write chunking, notification reassembly with resync |
| `src/lib/viatom/commands.ts` | request builders (info, set time, live, file open/read/close) |
| `src/lib/viatom/live.ts`, `info.ts`, `file.ts` | response parsers (+ file encoder used by demo/tests) |
| `src/ble/webBluetooth.ts` | Web Bluetooth transport (chooser filters, GATT setup, writes, reconnect) |
| `src/ble/client.ts` | half-duplex request queue, timeouts/retries, live polling, file download, auto-reconnect |
| `src/ble/sync.ts` | download every not-yet-saved recording |
| `src/demo/` | simulated nights + a fake O2 device that speaks the same byte protocol (demo mode runs the real client code) |
| `src/lib/analytics.ts` | zones, per-night stats, drops, insights |
| `src/db/sessions.ts`, `src/lib/csv.ts` | IndexedDB storage, dedupe, CSV export |
| `src/views/`, `src/components/` | UI |

## Deploy to an HTTPS URL

**This repo deploys itself to GitHub Pages** via `.github/workflows/deploy.yml` on every push to `main`
(it runs the tests, builds with `BASE_PATH=/<repo>/`, and publishes `dist/`). One-time setup: repo
**Settings → Pages → Build and deployment → Source: GitHub Actions**. Note GitHub Pages for a *private*
repository needs a paid plan (Pro / Team / Enterprise).

PNG icons are generated by `scripts/make-icons.mjs` (runs automatically before `npm run build`), so no
binary files are kept in git.

`npm run build` produces a plain static folder (`dist/`) with relative paths, so it works at a domain root or a
sub-path. Any static host with HTTPS works:

| Option | How | Account needed? |
|---|---|---|
| **Netlify Drop** | Drag the `dist/` folder onto <https://app.netlify.com/drop> | Free Netlify account to keep it. Without signing in the site is password-protected and deleted after 1 hour unless you claim it |
| **Cloudflare Pages** | Dashboard → Pages → *Upload assets* → drop `dist/`, or `npx wrangler pages deploy dist` | Free Cloudflare account |
| **GitHub Pages** | Push the repo, build with an Action (or commit `dist/` to a `gh-pages` branch) | GitHub account |
| **Vercel** | `npx vercel deploy dist --prod` | Free Vercel account |
| **Surge** | `npx surge dist my-o2vibe.surge.sh` | Creates a free account (email + password) on first run |
| **Quick test without hosting** | On a computer: `npx vite preview --host`, then use Chrome’s *Remote devices* port-forwarding (`chrome://inspect`, forward port 4173 to `localhost:4173`) so the phone opens `http://localhost:4173` | None (USB debugging enabled on the phone) |

A temporary tunnel (e.g. `npx localtunnel --port 4173` or `cloudflared tunnel --url http://localhost:4173`) also gives an
https URL with no account, but it only lives as long as the computer runs it, so it’s good for testing, not daily use.

## Protocol notes: what is confirmed vs inferred

The O2 Vibe isn’t documented publicly. It belongs to Viatom’s **legacy “O2” BLE protocol** family. Everything below
comes from open-source references; the app has **not yet been tested against a physical O2 Vibe**.

**Sources**

- Viatom’s own Android demo SDK, `viatom-develop/LepuBle` — `OxyBleManager.java` (UUIDs), `OxyBleCmd.java` (opcodes, request
  framing, `getRtWave`), `OxyBleResponse.kt` (live wave + info layouts), `OxyBleInterface.kt` (response reassembly and download
  flow), `OxyDataFile.kt` (recording format), `BleCRC.java` (CRC table). Its README lists “O2 serial: CheckO2, O2Ring, SleepO2 …”.
- `MackeyStingray/o2r` (Python; O2Ring / Checkme O2 / SleepU / WearO2 / BabyO2 / Oxylink): opcodes, CRC, file download, read-sensors layout, v3 file reader.
- `ecostech/viatom-ble` (Python): live-sensor request `aa 17 e8 00 00 00 00 1b` and notification byte offsets.
- `farolone/wellue-o2ring-protocol` and Sam Afshari’s “Talking to a Bluetooth (BLE) Pulse Oximeter” notes: framing and CRC.
- `nglessner/o2ring-s-protocol`: the newer “OxyII” service used by O2Ring S (T8520) — **not** implemented, only detected.

**Confirmed by several independent sources (high confidence for the O2 family)**

- Service `14839ac4-7d7e-415c-9a42-167340cf2339`, write `8b00ace7-eb0b-49b0-bbe9-9aee0a26e1a3`, notify `0734594a-a8e7-4b1a-a6b1-cd5243059a57`.
- Frame: `AA cmd ~cmd blockLo blockHi lenLo lenHi payload… crc`; responses start with `55`, byte 1 is status (0 = OK).
- CRC-8 poly 0x07, init 0 over all bytes but the last (unit-tested against the known `…1b` request and the vendor table).
- Writes split into 20-byte chunks; responses arrive split across notifications.
- `0x14` INFO returns JSON with `FileList` (comma-separated `YYYYMMDDhhmmss` names) and `CurTIME`; `0x16` sets time with `{"SetTIME":"YYYY-MM-DD,HH:MM:SS"}`.
- File download: `0x03` open (name + NUL → u32 size), `0x04` read with incrementing block number, `0x05` close.
- Recording: version 3, 40-byte header with start time, 5-byte records; SpO₂ in byte 0; 2 s or 4 s per record.

**Inferred / less certain**

- That the **O2 Vibe uses this legacy protocol at all.** It is an older Viatom wrist unit and its sibling devices do, but if its
  firmware uses the newer OxyII service the app will say so clearly instead of failing silently.
- **Advertised name.** The chooser accepts many prefixes (`O2`, `O2 Vibe`, `O2Vibe`, `Checkme`, `SleepU`, `BodiMetrics`, `Wellue`, …) plus the
  service UUID, and there’s a “show all devices” fallback.
- **Live command.** The app uses the vendor SDK’s `0x1B` (SpO₂ + pulse + battery + PI + 125 Hz pleth). If the device doesn’t answer it
  three times in a row it switches to `0x17` (numbers only, as used by o2r / viatom-ble). Wave bytes are inverted to match the vendor drawing code;
  the value 156 is treated as an invalid marker.
- **Record bytes 1–2.** The vendor SDK reads them as a u16 pulse (0xFFFF = invalid); o2r reads byte 1 as pulse and byte 2 as an “invalid” flag. Both agree
  for real pulse values (< 256). Byte 3 is motion; byte 4 is reserved / vibration.
- **Header fields after the start time** (summary values such as time under 90 %) differ slightly between the two references. The app
  calculates its own statistics from the samples and doesn’t rely on them.
- File timestamps are treated as the device’s local time (the app sets the device clock to the phone’s time on every connection).

## How a night is rated (v2)

The rating is the **worst** criterion met. A night is never shown as "Looks normal" when any red criterion applies.
Invalid samples (0, 255, SpO2 outside 50–100, pulse outside 25–250, sensor off) are dropped first. They create no false lows, hide no real lows, and are reported as "no / bad signal" time.
The lowest reading (nadir) must be held for about 8 s (2 samples at 4 s), so a one-sample glitch is not reported as the nadir. Every low sample still counts towards T90, T88 and the other time-below totals.

| Level | Shown as | Triggered by any of |
|---|---|---|
| 3 – deep red banner | **Very low oxygen** | nadir < 85% · ≥ 1 min < 85% · ≥ 5 min < 88% (T88) · T90 ≥ 30 min or ≥ 10% of the night · one continuous stretch < 90% ≥ 5 min · ODI ≥ 30/h (severe) · average SpO2 < 90% |
| 2 – red banner | **Low oxygen** | nadir < 90% · T90 ≥ 1 min or ≥ 1% of the night · any time < 88% · continuous stretch < 90% ≥ 2 min · ODI 15–30/h (moderate) · average < 92% · pulse < 40 for ≥ 30 s · pulse > 120 for ≥ 30 s |
| 1 – amber | **Worth watching** | any time < 90% · ODI 5–15/h (mild) · average < 94% · average pulse < 50 or ≥ 5 min < 50 · pulse > 100 for ≥ 2 min |
| 0 – green | **Looks normal** | none of the above |

ODI-3 / ODI-4 count falls of ≥ 3 / ≥ 4 points below the median of the previous 2 minutes, lasting ≥ 10 s. The bands are the usual < 5 normal, 5–15 mild, 15–30 moderate and > 30 severe.
Chart colours: SpO2 is green ≥ 95, amber 90–94, orange-red 88–89 and deep red < 88. Pulse is blue 50–100, amber 40–49 / 101–120 and deep red < 40 / > 120.
