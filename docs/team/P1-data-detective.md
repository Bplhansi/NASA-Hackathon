# P1: Data Detective (NASA data · water measurement · scan engine)

**Mission:** You own the **science** of Earth Detective. You turn real NASA satellite images into numbers. Everyone else draws what you measure. If your numbers are real and honest, the project wins on "Fits the challenge".

You build:
- `js/cases.js`: the case-study places
- `js/nasa.js`: NASA image URLs, image loading, EONET fetch
- `js/measure.js`: counting water pixels in an image
- `js/scan.js`: `runScan()`, the terminal log, the `ScanResult` and the finding sentence
- `mock/scan-aral.json`: fake data so P2 and P3 can start in hour 1
- README section **"How the scan works"**

> Read `00-shared-contract.md` first, especially §6 (data shapes), §7 (NASA sources) and §8 (honesty rule).

---

## Step 0 · First hour (others are waiting on you)

- [ ] Commit **`mock/scan-aral.json`**: a full `ScanResult` exactly like contract §6.2, years 2000–2026, made-up but realistic numbers falling from ~41% to ~10%, with `"estimated": true` on every year. Mark it clearly as mock.
- [ ] Commit `js/cases.js` with the 3 cases from contract §6.1.
- [ ] Post in the team chat: "mock is in".

## Step 1 · `js/nasa.js`

```js
export function snapshotUrl(bbox, date, { width = 800, height = 640,
  layer = "MODIS_Terra_CorrectedReflectance_TrueColor" } = {}) { … }
export function loadImage(url) { … }        // Promise<HTMLImageElement>, crossOrigin = "anonymous", 20 s timeout
export async function fetchEvents() { … }   // Promise<EonetEvent[]> (contract §6.4)
```

- [ ] `snapshotUrl` builds the Worldview URL from contract §7. `BBOX` order is `latMin,lonMin,latMax,lonMax`.
- [ ] `loadImage` sets `img.crossOrigin = "anonymous"` **before** `img.src`, so the canvas can read pixels.
- [ ] `fetchEvents`: call EONET, skip events with no geometry, take the **latest** geometry point, and fill in `thumbUrl` with `snapshotUrl([lat-3, lon-3, lat+3, lon+3], date, {width: 480, height: 360})`. Skip titles starting with "RX" (planned burns), or label them "planned".
- [ ] Test in the browser console: `(await import('./js/nasa.js')).fetchEvents()`.

## Step 2 · `js/measure.js` (the core idea)

```js
export function measureWater(img) { … }
// returns { waterPct, cloudPct, valid: boolean }
```

- [ ] Draw the image on an off-screen canvas (downscale to 400 px wide; it's faster and good enough).
- [ ] For each pixel: **water** = blue-ish and dark (`b > r && b >= g - 10 && (r+g+b)/3 < 90`). **Cloud** = very bright and grey (`(r+g+b)/3 > 200 && max-min < 25`). **No data** = pure black (MODIS swath gaps).
- [ ] `waterPct` = water ÷ valid pixels × 100. If `cloudPct > 30` or no-data > 20%, set `valid: false`.
- [ ] **Tune the thresholds on the real Aral Sea 2000 and 2026 images.** Paint water pixels bright cyan on a debug canvas and look: does it match the lake? Save a before/after debug screenshot to `assets/debug-mask.png`. It's a great slide for judges.
- [ ] If `getImageData` throws a CORS error, return `{ waterPct: null, valid: false, corsBlocked: true }`. Never crash.

## Step 3 · `js/scan.js`

```js
export async function runScan(caseId) { … }  // Promise<ScanResult>
```

- [ ] Log every step with `scan:log` events (contract §6.3), for example:
  - `› Scanning Aral Sea, 2000–2026…` (info)
  - `⬇ NASA MODIS Terra · 2000-08-20` (data), one line per year
  - `☁ 2004 too cloudy, trying 2004-08-27` (warn)
  - `⚠ Change detected: −76%` (warn)
  - `✓ Case file ready` (ok)
- [ ] For each year 2000 → current year: try `YYYY-monthDay`. If it's cloudy or failed, retry **+7 days** and **−7 days** (up to 2 retries). Then mark it `"cloudy"` / `"failed"` with `waterPct: null`.
- [ ] Load images **4 at a time** (`Promise.all` in batches) so the scan takes under ~20 s.
- [ ] Compute `first`, `latest`, `changePct`, `biggestDrop` (the biggest fall between two neighbouring OK years) and `finding` (one or two plain-English sentences, no jargon).
- [ ] Fire `scan:done` with the result. On a total failure fire `scan:error`.
- [ ] **Cache** results in `sessionStorage` by `caseId`, so a demo re-run is instant. Add a "Rescan" option that ignores the cache.
- [ ] Build the **terminal panel** UI in the Scan tab: a dark box with monospace lines, coloured by `kind`. P3 gives you the empty `<div id="terminal">` in `index.html`.

## Step 4 · More cases (Sunday morning)

- [ ] Run Lake Urmia and Lake Mead. If one gives silly numbers (salt flats, a tiny lake), tune the bbox or drop it and say so. **Two good cases beat three bad ones.**
- [ ] Optional stretch: a "Custom place" option where you type a bbox.

## Step 5 · README: "How the scan works" (for the judges)

- [ ] Data: NASA Worldview Snapshot API, MODIS Terra Corrected Reflectance (true colour), one image per year in late August, 2000 to today.
- [ ] Method: count water-coloured pixels per image → % of the area → trend across years.
- [ ] Checks: cloud/no-data filter, ±7-day retry, gaps shown, never filled.
- [ ] **Limits (be honest):** 250 m pixels, haze, shallow or salty water may look like land, one date per year misses seasons, % of the image box not km².
- [ ] Compare with a known fact: NASA Earth Observatory has written about the Aral Sea shrinking. Link it as a sanity check, and say whether our trend agrees.

## Prompt for your coding agent

```text
Read docs/team/00-shared-contract.md and docs/team/P1-data-detective.md. I am P1.
Only create or edit these files: js/cases.js, js/nasa.js, js/measure.js, js/scan.js, mock/scan-aral.json and the "How the scan works" section of README.md.
Build them exactly to the data shapes and events in contract section 6. Plain ES modules, no libraries, no API keys.
Start with mock/scan-aral.json and js/cases.js, then nasa.js, measure.js, scan.js in that order.
Never invent numbers: anything not measured from an image must have estimated: true.
After each file, tell me how to test it in the browser console.
```

## Done when

- [ ] `runScan("aral")` returns a real `ScanResult` with at least 20 measured years.
- [ ] The Aral Sea trend clearly goes down, and the debug mask matches the lake by eye.
- [ ] Cloudy years show as gaps, not guesses.
- [ ] `fetchEvents()` returns live events with working thumbnails.
- [ ] No red errors in the console. README method section written.
