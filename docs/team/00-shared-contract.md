# Earth Detective: shared team contract (all 3 people and their coding agents read this first)

> **This file is the single source of truth.** P1–P3 each have their own file (`P1-…md` to `P3-…md`) with step-by-step tasks. Your file tells you *what* to build. This file tells you *how we build together*: the repo, the folders, the shared data shapes, the Git rules, the design tokens and the deadline. **Copy this whole `team/` folder into the repo at `docs/team/`** so every coding agent can read it.

---

## 1. What we are building (one paragraph)

**Earth Detective** is a web app for NASA Space Apps 2026, challenge **"Be An Earth System Trend Detective!"**. You pick a place (the Aral Sea, Lake Urmia or Lake Mead). Press **Run Detective Scan** and the app downloads a real NASA satellite image for every year since 2000. It measures how much water is in each image and charts the trend. Then it writes a plain-English finding ("Water area is down X% since 2000"). The finding becomes a post in an Instagram-style **feed**, next to real **live disasters from NASA EONET**. People can add **solutions** to each post. A **Time Machine** swipe shows the same place in 2000 and today.

**Future vision (poster only, not built):** block-world game, disaster simulations, 3D God's Eye globe. Use `earth-live-full-concept.png` in the submission for this.

## 2. Team and roles

| Role | Person | Owns |
|---|---|---|
| **P1: Data Detective** | _name_ | NASA data loading, water measurement, the scan engine, `ScanResult`, the method README |
| **P2: Trend Visualiser** | _name_ | Results chart, finding text, Time Machine swipe + year slider, detective note |
| **P3: Product Lead** | _name_ | Repo, app shell, design system, feed, EONET cards, Solutions box, demo video, Space Apps submission |

**P3 is the repo admin** and merges every pull request.

## 3. Deadline and timeline

**Hard deadline: Sun 15 Nov 2026, 11:59 PM local time.** We submit by **9:00 PM** and keep the last 3 hours as a safety buffer.

| When | Everyone |
|---|---|
| **Sat, hour 0–1** | P3 creates the repo and skeleton. P1 commits `mock/scan-aral.json`. Everyone reads this file. |
| **Sat, hour 1–6** | Build your own part **against the mock data**. Push small PRs. |
| **Sat night** | First full integration: real scan → chart → feed post. |
| **Sun until 2 PM** | Fix bugs, add Lake Urmia and Lake Mead, polish the design. |
| **Sun 2 PM** | 🧊 **Feature freeze.** Only bug fixes after this. |
| **Sun 2–6 PM** | P3 records the demo video. P1 finalises the README. P2 makes screenshots. |
| **Sun by 9 PM** | ✅ **Submitted** on spaceappschallenge.org (Universal Event, Terms + Original ticked). |

## 4. Tech rules

- **Plain HTML + CSS + JavaScript ES modules.** No framework, no build step, no backend, no API keys.
- One library only: **Chart.js 4.4.1** from cdnjs (`https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js`).
- ES modules don't load from `file://`. Run a local server from the repo folder:
  - `python -m http.server 8000` then open `http://localhost:8000`, **or**
  - VS Code "Live Server" extension.
- Hosted on **GitHub Pages** from the `main` branch (P3 switches it on).
- Must work in Chrome and on a phone-width screen (375 px).

## 5. Repo structure (who owns which file)

```
earth-detective/
├── index.html              P3  app shell: header, 3 tabs (Scan · Time Machine · Feed), script tags
├── css/style.css           P3  design tokens + shared components (cards, buttons, chips)
├── css/scan.css            P2  chart + time machine styles
├── js/main.js              P3  starts the app, tab switching, wires the modules together
├── js/cases.js             P1  list of case-study places
├── js/nasa.js              P1  Worldview snapshot URLs, image loading, EONET fetch
├── js/measure.js           P1  water-pixel measurement on a canvas
├── js/scan.js              P1  runScan(): the scan pipeline + terminal log + finding
├── js/chart.js             P2  renderChart(result)
├── js/timemachine.js       P2  renderTimeMachine(result): swipe + year slider + note
├── js/feed.js              P3  renderFeed(), scan post card, EONET cards, ⓘ panel
├── js/solutions.js         P3  Solutions box (localStorage)
├── mock/scan-aral.json     P1  a fake ScanResult so P2 and P3 can work from hour 1
├── assets/                 P3  logo, poster, screenshots
├── docs/team/              all  these contract files
└── README.md               P1 writes "How the scan works", P3 writes the rest
```

**Never edit a file you don't own.** If you need a change in someone else's file, ask them in the team chat or open an issue.

## 6. Shared data shapes (the contract between P1, P2 and P3)

### 6.1 Case

```js
// js/cases.js (P1)
export const CASES = [
  { id: "aral",  name: "Aral Sea",   country: "Kazakhstan / Uzbekistan",
    bbox: [43, 57.5, 47, 62.5],      // [latMin, lonMin, latMax, lonMax]
    monthDay: "08-20" },             // the date to use every year (cloud-free season)
  { id: "urmia", name: "Lake Urmia", country: "Iran",
    bbox: [37, 44.9, 38.5, 46.2],    monthDay: "08-20" },
  { id: "mead",  name: "Lake Mead",  country: "USA",
    bbox: [35.9, -115, 36.6, -114],  monthDay: "08-20" },
];
```

### 6.2 ScanResult (P1 produces it, P2 and P3 read it)

```js
{
  caseId: "aral",
  name: "Aral Sea",
  bbox: [43, 57.5, 47, 62.5],
  source: "NASA Worldview · MODIS Terra true colour",
  years: [
    { year: 2000, date: "2000-08-20", imageUrl: "https://wvs.earthdata.nasa.gov/…",
      waterPct: 41.2,          // % of image pixels that are water, or null
      status: "ok",            // "ok" | "cloudy" | "failed"
      estimated: false },      // true if we could not measure and used a fallback
    // … one entry per year up to the latest
  ],
  first:  { year: 2000, waterPct: 41.2 },   // first year with status "ok"
  latest: { year: 2026, waterPct: 9.8 },    // last year with status "ok"
  changePct: -76.2,                          // (latest - first) / first * 100
  biggestDrop: { from: 2008, to: 2009, deltaPct: -18.4 },
  finding: "Water area is down 76% since 2000. The biggest single drop was 2008 → 2009.",
  scannedAt: "2026-11-15T10:12:00Z"
}
```

### 6.3 Events between modules

All modules talk through **`document` events**, so nobody needs to import anyone else's file.

| Event | Fired by | `detail` | Who listens |
|---|---|---|---|
| `scan:log` | P1 `scan.js` | `{ text, kind }` where kind is `"info"`, `"data"`, `"warn"` or `"ok"` | P1 terminal panel |
| `scan:done` | P1 `scan.js` | `ScanResult` | P2 chart + time machine, P3 feed |
| `scan:error` | P1 `scan.js` | `{ message }` | P3 shows a toast |
| `nav:go` | anyone | `{ tab: "scan" \| "time" \| "feed" }` | P3 `main.js` switches tab |

```js
// fire
document.dispatchEvent(new CustomEvent("scan:done", { detail: result }));
// listen
document.addEventListener("scan:done", (e) => renderChart(e.detail));
```

### 6.4 EONET event (P1 fetches it, P3 shows it)

```js
{ id: "EONET_1234", title: "Typhoon Cempaka", category: "Severe Storms",
  date: "2026-11-11", lat: 25.1, lon: 135.6,
  magnitude: "95 kts" /* or null */, link: "https://eonet.gsfc.nasa.gov/…",
  thumbUrl: "https://wvs.earthdata.nasa.gov/…" }
```

## 7. NASA data sources (no keys needed)

| What | URL |
|---|---|
| Satellite image of a box on a date | `https://wvs.earthdata.nasa.gov/api/v1/snapshot?REQUEST=GetSnapshot&CRS=EPSG:4326&FORMAT=image/jpeg&TIME=YYYY-MM-DD&BBOX=LATMIN,LONMIN,LATMAX,LONMAX&WIDTH=800&HEIGHT=640&LAYERS=MODIS_Terra_CorrectedReflectance_TrueColor` |
| Live natural events | `https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=20&limit=20` |
| Links for the ⓘ panel | worldview.earthdata.nasa.gov · earthobservatory.nasa.gov · eonet.gsfc.nasa.gov |

MODIS Terra images start in **2000**. That is why every chart starts in 2000.

## 8. The honesty rule (judges check this)

- **Every number on screen comes from a measured NASA image, or carries the label "estimate".**
- No invented statistics, likes, users or quotes. Placeholder names in the feed say "example".
- Cloudy or failed years are **skipped and shown as gaps**, not filled with guesses.
- The README explains the method's limits (clouds, haze, salt flats that look like water, seasonal change).

## 9. Design tokens (P3 owns, everyone uses)

```css
:root {
  --bg: #0a0f1e;   --card: #121a30;  --card-2: #161f38;  --line: #25304f;
  --text: #e6eaf6; --muted: #9aa5c4; --faint: #5f6a8a;
  --yellow: #ffcc33; --green: #4fe0a0; --cyan: #3ee0ff; --purple: #b58cff; --red: #ff6b81; --blue: #4fb3ff;
  --radius: 18px;  --font: "Segoe UI", system-ui, sans-serif;  --mono: Consolas, Menlo, monospace;
}
```

Use **`var(--…)` only**, never hard-coded colours. Buttons are `.btn` (primary) and `.btn-ghost`. Cards are `.card`. Use emoji for icons. **Don't use logos or art from any real game or social network.**

## 10. Git and PR rules

- `main` is always working and is what GitHub Pages shows.
- Branch names: `p1/scan-engine`, `p2/chart`, `p3/feed` and so on.
- **Small PRs, often** (at least every 2 hours). The title says what it does: "Add water measurement".
- Before opening a PR: run the local server, open the app, check **there are no red errors in the console**.
- P3 reviews and merges. If P3 is busy for more than 20 minutes, the PR author may merge their **own files only**.
- Never force-push to `main`. Never commit API keys or personal info.

## 11. Definition of done (the demo must do this, start to finish, in under 2 minutes)

1. Open the app link → the **Scan** tab loads.
2. Pick **Aral Sea** → press **🕵️ Run Detective Scan** → the terminal log animates.
3. Real NASA images load. The **chart** draws water % by year, with the biggest drop in red.
4. The finding appears: "Water area is down X% since 2000."
5. **Time Machine** tab: drag the swipe between 2000 and today. The year slider works.
6. **Feed** tab: the scan is post #1 as **@detective_scan · NEW TREND**. Live EONET disasters follow, with satellite thumbnails.
7. Tap **💡 Solutions** → type an idea, tag it Before / During / After, upvote it → it stays after reload.
8. Tap **ⓘ** → NASA links open.

## 12. Submission checklist (P3 leads, everyone checks)

- [ ] Both members switched to the **Universal Event**
- [ ] **Terms** and **Original** boxes ticked
- [ ] Project title, 1-line summary, full description
- [ ] Demo link (GitHub Pages) + repo link
- [ ] 30-second demo video (screen recording of section 11)
- [ ] Concept poster as the "future vision" image
- [ ] "NASA data used" list: Worldview / MODIS Terra, EONET
- [ ] "Use of AI" statement (we used AI coding assistants; say so honestly)
- [ ] Submitted by **9:00 PM Sun 15 Nov**
