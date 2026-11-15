// js/scan.js (P1) — runScan(): the scan pipeline, terminal log and finding.
//
// Events (contract §6.3):
//   scan:log   { text, kind }   kind = "info" | "data" | "warn" | "ok"
//   scan:done  ScanResult
//   scan:error { message }
//
// Usage:
//   import { runScan, mountTerminal } from "./js/scan.js";
//   mountTerminal(document.getElementById("terminal"));   // auto-mounted if #terminal exists
//   await runScan("aral");                    // uses the sessionStorage cache if present
//   await runScan("aral", { rescan: true });  // ignore the cache

import { getCase } from "./cases.js";
import { snapshotUrl, loadImage } from "./nasa.js";
import { measureWater } from "./measure.js";

const FIRST_YEAR = 2000; // MODIS Terra starts in 2000
const BATCH_SIZE = 4;
const RETRY_OFFSETS = [0, 7, -7]; // days: the date, then +7, then −7
const CACHE_PREFIX = "earth-detective:scan:v3:";
const SOURCE = "NASA Worldview · MODIS Terra true colour + bands 7-2-1";

// ---------- events ----------

function log(text, kind = "info") {
  document.dispatchEvent(new CustomEvent("scan:log", { detail: { text, kind } }));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- dates ----------

function shiftDate(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// ---------- one year ----------

const IR_LAYER = "MODIS_Terra_CorrectedReflectance_Bands721";
const GOOD_CLOUD_PCT = 10; // accept a date straight away if it is this clear

async function measureDate(c, date) {
  const imageUrl = snapshotUrl(c.bbox, date);
  const analysisUrl = snapshotUrl(c.bbox, date, { layer: IR_LAYER });
  try {
    const [tc, ir] = await Promise.all([loadImage(imageUrl), loadImage(analysisUrl)]);
    return { date, imageUrl, analysisUrl, ...measureWater(tc, ir) };
  } catch (err) {
    return { date, imageUrl, analysisUrl, valid: false, failed: true };
  }
}

async function scanYear(c, year) {
  const baseDate = `${year}-${c.monthDay}`;
  const today = todayIso();
  const tries = [];

  for (let attempt = 0; attempt < RETRY_OFFSETS.length; attempt++) {
    const date = shiftDate(baseDate, RETRY_OFFSETS[attempt]);
    if (date >= today) continue; // no imagery from the future (or today, still processing)
    if (attempt === 0) log(`⬇ NASA MODIS Terra · ${date}`, "data");

    const m = await measureDate(c, date);
    tries.push(m);
    if (m.valid && m.cloudPct <= GOOD_CLOUD_PCT) break; // clear enough, stop here

    if (m.corsBlocked) log(`⚠ ${year}: browser blocked pixel access (CORS)`, "warn");
    const next = RETRY_OFFSETS[attempt + 1];
    if (next !== undefined) {
      const nextDate = shiftDate(baseDate, next);
      const why = m.failed || m.corsBlocked ? "image failed" : m.hazy ? "hazy" : `${m.cloudPct}% cloud`;
      log(`☁ ${year} ${why}, trying ${nextDate}`, "warn");
    }
  }

  // best = the valid try with the least cloud
  const best = tries.filter((t) => t.valid).sort((a, b) => a.cloudPct - b.cloudPct)[0];
  if (best) {
    return { year, date: best.date, imageUrl: best.imageUrl, analysisUrl: best.analysisUrl,
      waterPct: best.waterPct, status: "ok", estimated: false, cloudPct: best.cloudPct };
  }

  const status = tries.some((t) => !t.failed && !t.corsBlocked) ? "cloudy" : "failed";
  log(`✗ ${year} skipped (${status}) — shown as a gap`, "warn");
  const first = tries[0] || { imageUrl: snapshotUrl(c.bbox, baseDate) };
  return { year, date: first.date || baseDate, imageUrl: first.imageUrl, waterPct: null, status, estimated: false };
}

// ---------- summary ----------

const round1 = (n) => Math.round(n * 10) / 10;

export function summarise(c, years) {
  const ok = years.filter((y) => y.status === "ok" && y.waterPct != null);
  const first = ok[0] ? { year: ok[0].year, waterPct: ok[0].waterPct } : null;
  const latest = ok.length ? { year: ok.at(-1).year, waterPct: ok.at(-1).waterPct } : null;

  let changePct = null;
  if (first && latest && ok.length >= 2 && first.waterPct > 0) {
    changePct = round1(((latest.waterPct - first.waterPct) / first.waterPct) * 100);
  }

  // biggest fall between two neighbouring OK years (deltaPct in percentage points of the image)
  let biggestDrop = null;
  for (let i = 1; i < ok.length; i++) {
    const delta = round1(ok[i].waterPct - ok[i - 1].waterPct);
    if (delta < 0 && (!biggestDrop || delta < biggestDrop.deltaPct)) {
      biggestDrop = { from: ok[i - 1].year, to: ok[i].year, deltaPct: delta };
    }
  }

  return { first, latest, changePct, biggestDrop, finding: writeFinding(first, latest, changePct, biggestDrop, years) };
}

function writeFinding(first, latest, changePct, biggestDrop, years) {
  if (changePct == null) {
    return "Not enough clear satellite images to measure a trend for this place.";
  }
  const pct = Math.abs(Math.round(changePct));
  let s;
  if (pct < 3) {
    s = `Water area stayed about the same between ${first.year} and ${latest.year}.`;
  } else if (changePct < 0) {
    s = `Water area is down ${pct}% since ${first.year}.`;
  } else {
    s = `Water area is up ${pct}% since ${first.year}.`;
  }
  if (biggestDrop && changePct < 0) {
    s += ` The biggest single drop was ${biggestDrop.from} → ${biggestDrop.to}.`;
  }
  const gaps = years.filter((y) => y.status !== "ok").length;
  if (gaps) s += ` ${gaps} cloudy or missing year${gaps > 1 ? "s were" : " was"} left as gaps.`;
  return s;
}

// ---------- cache ----------

function readCache(caseId) {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + caseId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(result) {
  try {
    sessionStorage.setItem(CACHE_PREFIX + result.caseId, JSON.stringify(result));
  } catch { /* storage full or blocked — fine, just no cache */ }
}

export function clearScanCache(caseId) {
  try { sessionStorage.removeItem(CACHE_PREFIX + caseId); } catch { /* ignore */ }
}

// ---------- main ----------

let running = false;

/** Scan every year from 2000 to now for one case. Resolves to a ScanResult (contract §6.2). */
export async function runScan(caseId, { rescan = false } = {}) {
  if (running) {
    log("… a scan is already running", "warn");
    return null;
  }
  running = true;
  try {
    const c = getCase(caseId);
    if (!c) throw new Error(`Unknown place "${caseId}"`);

    const lastYear = new Date().getUTCFullYear();

    if (!rescan) {
      const cached = readCache(caseId);
      if (cached) {
        log(`› Scanning ${c.name}, ${FIRST_YEAR}–${lastYear}…`, "info");
        log(`↺ Loaded case file from this session (press Rescan for fresh images)`, "info");
        await wait(250);
        logSummary(cached);
        document.dispatchEvent(new CustomEvent("scan:done", { detail: cached }));
        return cached;
      }
    }

    log(`› Scanning ${c.name}, ${FIRST_YEAR}–${lastYear}…`, "info");
    log(`› Source: ${SOURCE} · box ${c.bbox.join(", ")}`, "info");

    const yearList = [];
    for (let y = FIRST_YEAR; y <= lastYear; y++) {
      if (`${y}-${c.monthDay}` < todayIso()) yearList.push(y);
    }

    const years = [];
    for (let i = 0; i < yearList.length; i += BATCH_SIZE) {
      const batch = yearList.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map((y) => scanYear(c, y)));
      for (const r of results) {
        if (r.status === "ok") log(`  ${r.year}: water ${r.waterPct}% of image`, "data");
        years.push(r);
      }
    }

    const okCount = years.filter((y) => y.status === "ok").length;
    if (okCount === 0) {
      throw new Error("No clear NASA images could be measured. Check your connection and try again.");
    }

    const result = {
      caseId: c.id,
      name: c.name,
      bbox: c.bbox,
      source: SOURCE,
      years,
      ...summarise(c, years),
      scannedAt: new Date().toISOString(),
    };

    logSummary(result);
    writeCache(result);
    document.dispatchEvent(new CustomEvent("scan:done", { detail: result }));
    return result;
  } catch (err) {
    const message = err?.message || String(err);
    log(`✗ ${message}`, "warn");
    document.dispatchEvent(new CustomEvent("scan:error", { detail: { message } }));
    return null;
  } finally {
    running = false;
  }
}

function logSummary(r) {
  const ok = r.years.filter((y) => y.status === "ok").length;
  log(`› ${ok} of ${r.years.length} years measured`, "info");
  if (r.changePct != null) {
    const sign = r.changePct > 0 ? "+" : "−";
    const kind = Math.abs(r.changePct) >= 10 ? "warn" : "info";
    log(`⚠ Change detected: ${sign}${Math.abs(Math.round(r.changePct))}%`, kind);
  }
  log(`✓ Case file ready`, "ok");
}

// ---------- terminal panel ----------

const TERMINAL_CSS = `
.ed-terminal{background:var(--bg,#0a0f1e);border:1px solid var(--line,#25304f);border-radius:var(--radius,18px);
  padding:14px 16px;font-family:var(--mono,Consolas,Menlo,monospace);font-size:13px;line-height:1.55;
  height:260px;overflow-y:auto;color:var(--muted,#9aa5c4);white-space:pre-wrap;word-break:break-word}
.ed-terminal .ed-line{animation:ed-in .18s ease-out}
.ed-terminal .k-info{color:var(--text,#e6eaf6)}
.ed-terminal .k-data{color:var(--cyan,#3ee0ff)}
.ed-terminal .k-warn{color:var(--yellow,#ffcc33)}
.ed-terminal .k-ok{color:var(--green,#4fe0a0)}
.ed-terminal .ed-empty{color:var(--faint,#5f6a8a)}
@keyframes ed-in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.ed-terminal .ed-line{animation:none}}
`;

let mountedEl = null;

/** Render scan:log events into `el` (a dark monospace box). Safe to call more than once. */
export function mountTerminal(el) {
  if (!el || el === mountedEl) return;
  if (!document.getElementById("ed-terminal-css")) {
    const style = document.createElement("style");
    style.id = "ed-terminal-css";
    style.textContent = TERMINAL_CSS;
    document.head.appendChild(style);
  }
  el.classList.add("ed-terminal");
  el.setAttribute("role", "log");
  el.setAttribute("aria-live", "polite");
  el.innerHTML = `<div class="ed-empty">Pick a place and press 🕵️ Run Detective Scan.</div>`;
  mountedEl = el;
}

document.addEventListener("scan:log", (e) => {
  if (!mountedEl) return;
  const { text, kind = "info" } = e.detail || {};
  if (text?.startsWith("› Scanning")) mountedEl.innerHTML = ""; // fresh log per scan
  mountedEl.querySelector(".ed-empty")?.remove();
  const line = document.createElement("div");
  line.className = `ed-line k-${kind}`;
  line.textContent = text;
  mountedEl.appendChild(line);
  mountedEl.scrollTop = mountedEl.scrollHeight;
});

function autoMount() {
  const el = document.getElementById("terminal");
  if (el) mountTerminal(el);
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", autoMount);
} else {
  autoMount();
}
