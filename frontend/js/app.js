// js/app.js: Earth Detective front end (plain ES module, talks to the Python backend in backend/).
// Every number shown comes from the backend, which gets it from NASA (Worldview/MODIS, POWER, EONET).

const PARAMS = new URLSearchParams(location.search);
const API = PARAMS.get("api") || window.ED_API || "";
const MOCK = PARAMS.get("mock") === "1"; // ?mock=1 → UI demo with mock/scan-aral.json, no backend needed
const WATER = "WATER";
const $ = (id) => document.getElementById(id);

const state = { cases: [], variables: [], caseId: "aral", varId: WATER, scan: null, current: null, chart: null };

const MOCK_VARIABLES = [{ id: "T2M", name: "Air temperature at 2 m", units: "°C", source: "MERRA-2", sphere: "atmosphere" }];
const MOCK_CASES = [{ id: "aral", name: "Aral Sea", country: "Kazakhstan / Uzbekistan", bbox: [43, 57.5, 47, 62.5], monthDay: "08-20" }];

async function mockApi(path) {
  if (path === "/api/cases") return MOCK_CASES;
  if (path === "/api/variables") return MOCK_VARIABLES;
  if (path === "/api/events") return [];
  if (path.startsWith("/api/scan/")) {
    const r = await (await fetch("mock/scan-aral.json")).json();
    return { ...r, country: "Kazakhstan / Uzbekistan", trendLine: null,
      stats: { error: "MOCK data: made-up numbers, so no significance test is run." },
      finding: `MOCK DATA (estimated, not measured). ${r.finding}`,
      log: [{ text: "⚠ MOCK mode: loading mock/scan-aral.json (made-up numbers, estimated: true)", kind: "warn" }, { text: "✓ Mock case file ready", kind: "ok" }] };
  }
  throw new Error("Not available in mock mode. Start the Python backend for real NASA data.");
}

async function api(path) {
  if (MOCK) return mockApi(path);
  const r = await fetch(API + path);
  if (!r.ok) {
    let msg = `${r.status}`;
    try { msg = (await r.json()).detail || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  return r.json();
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.style.display = "none"), 6000);
}

const fmtP = (p) => (p < 0.001 ? "< 0.001" : p.toFixed(3));
const fmt = (n, d = 2) => {
  if (n == null || Number.isNaN(n)) return "–";
  const a = Math.abs(n);
  const txt = a !== 0 && a < 0.1 ? Number(n).toPrecision(2) : Number(n).toFixed(d);
  return (n > 0 ? "+" : "") + txt;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const currentCase = () => state.cases.find((c) => c.id === state.caseId);
const centre = (c) => ({ lat: (c.bbox[0] + c.bbox[2]) / 2, lon: (c.bbox[1] + c.bbox[3]) / 2 });

// ---------------------------------------------------------------- tabs
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => go(b.dataset.tab)));
function go(tab) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${tab}`));
}
document.addEventListener("nav:go", (e) => go(e.detail.tab));

// ---------------------------------------------------------------- pickers
function renderPlaces() {
  $("places").innerHTML = state.cases.map((c) =>
    `<button class="chip ${c.id === state.caseId ? "active" : ""}" data-id="${c.id}">${esc(c.name)}<span class="faint"> · ${esc(c.country)}</span></button>`).join("");
  $("places").querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    state.caseId = b.dataset.id;
    renderPlaces();
  }));
}

function renderVariables() {
  const groups = {};
  for (const v of state.variables) (groups[v.sphere] ||= []).push(v);
  $("variable").innerHTML =
    `<optgroup label="Measured from satellite images"><option value="${WATER}">💧 Lake water area (MODIS Terra, % of image)</option></optgroup>` +
    Object.entries(groups).map(([g, vs]) => `<optgroup label="NASA POWER · ${esc(g)}">` +
      vs.map((v) => `<option value="${v.id}">${esc(v.name)} (${esc(v.units)}) · ${esc(v.source)}</option>`).join("") + "</optgroup>").join("");
  $("variable").value = state.varId;
  updateHint();
}
$("variable").addEventListener("change", (e) => { state.varId = e.target.value; updateHint(); });
function updateHint() {
  $("var-hint").textContent = state.varId === WATER
    ? "Measures the lake in one NASA image per year (20 Aug ±7 days), 2000 to today."
    : "Monthly NASA POWER data at the centre of the place, 2000–2025. The test removes the seasonal cycle.";
  $("map-btn").disabled = state.varId === WATER || !state.current;
}

// ---------------------------------------------------------------- terminal
async function playLog(lines) {
  const term = $("terminal");
  for (const l of lines) {
    const div = document.createElement("div");
    div.className = `k-${l.kind || "info"}`;
    div.textContent = l.text;
    term.appendChild(div);
    term.scrollTop = term.scrollHeight;
    await new Promise((r) => setTimeout(r, lines.length > 30 ? 25 : 60));
  }
}
function logLine(text, kind = "info") { return playLog([{ text, kind }]); }

// ---------------------------------------------------------------- run
$("run").addEventListener("click", run);
async function run() {
  const c = currentCase();
  if (!c) return;
  $("run").disabled = true;
  $("terminal").innerHTML = "";
  $("map").innerHTML = "";
  $("map-legend").textContent = "";
  try {
    if (state.varId === WATER) {
      await logLine(`› Asking the backend to measure ${c.name} in every NASA image since 2000…`);
      const wait = setInterval(() => logLine("  … downloading and measuring NASA MODIS images", "data"), 4000);
      let r;
      try { r = await api(`/api/scan/${c.id}${$("rescan").checked ? "?rescan=true" : ""}`); }
      finally { clearInterval(wait); }
      await playLog(r.log);
      state.scan = r;
      state.current = {
        kind: "water", title: `${r.name}: lake water area`, units: "% of image", source: r.source,
        points: r.years.map((y) => ({ x: y.year, y: y.waterPct })), line: r.trendLine, stats: r.stats,
        finding: r.finding, biggestDrop: r.biggestDrop, perDecadeUnit: "points of the image",
      };
      document.dispatchEvent(new CustomEvent("scan:done", { detail: r }));
    } else {
      const v = state.variables.find((x) => x.id === state.varId);
      const { lat, lon } = centre(c);
      await logLine(`› ${c.name} · ${v.name} · NASA POWER (${v.source}) at ${lat.toFixed(2)}, ${lon.toFixed(2)}`);
      await logLine("⬇ Fetching monthly values 2000–2025…", "data");
      const r = await api(`/api/trend?var=${v.id}&lat=${lat}&lon=${lon}`);
      const s = r.stats;
      await playLog([
        { text: `  ${r.series.length} monthly values received`, kind: "data" },
        { text: `∑ Seasonal Mann-Kendall p ${fmtP(s.p_value)} → ${s.significant ? "significant" : "not significant"}`, kind: "data" },
        { text: `∑ Sen's slope ${fmt(s.slope_per_decade)} ${v.units} per decade`, kind: "data" },
        { text: "✓ Case file ready", kind: "ok" },
      ]);
      state.current = {
        kind: "power", title: `${c.name}: ${v.name}`, units: v.units, source: r.source,
        points: r.annual.map((a) => ({ x: a.year, y: a.value })), line: r.annual_trend_line, stats: s,
        finding: powerFinding(c, v, s), perDecadeUnit: v.units,
      };
    }
    renderChart();
    renderVerdict();
    updateHint();
  } catch (err) {
    await logLine(`✗ ${err.message}`, "warn");
    toast(`Scan failed: ${err.message}`);
    document.dispatchEvent(new CustomEvent("scan:error", { detail: { message: err.message } }));
  } finally {
    $("run").disabled = false;
  }
}

function powerFinding(c, v, s) {
  if (s.error) return "Not enough NASA data points for a trend here.";
  const total = `${fmt(s.total_change)} ${v.units} over ${Math.round(s.end - s.start)} years`;
  return s.significant
    ? `${v.name} at ${c.name} is ${s.trend} by about ${fmt(s.slope_per_decade)} ${v.units} per decade (${total}). This is statistically significant (p ${fmtP(s.p_value)}).`
    : `${v.name} at ${c.name} shows no statistically significant trend since 2000 (p ${fmtP(s.p_value)}). Sen's slope is ${fmt(s.slope_per_decade)} ${v.units} per decade.`;
}

// ---------------------------------------------------------------- chart
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function renderChart() {
  const cur = state.current;
  $("chart-title").textContent = cur.title;
  $("chart-source").textContent = cur.source;
  $("finding").textContent = cur.finding;
  const drop = cur.biggestDrop;
  const colors = cur.points.map((p) => (drop && p.x === drop.to ? css("--red") : css("--cyan")));
  const data = {
    datasets: [
      { label: cur.kind === "water" ? "Measured water % (gaps = cloudy years)" : "Annual mean",
        data: cur.points, borderColor: css("--cyan"), backgroundColor: colors, pointBackgroundColor: colors,
        pointRadius: cur.points.map((p) => (drop && p.x === drop.to ? 6 : 3)), spanGaps: false, tension: 0.2 },
      { label: cur.line ? `Sen's slope trend (${fmt(cur.stats.slope_per_decade)} ${cur.perDecadeUnit}/decade)` : "No trend line",
        data: (cur.line || []).map(([x, y]) => ({ x, y })), borderColor: css("--yellow"), borderDash: [6, 4],
        pointRadius: 0, fill: false },
    ],
  };
  const options = {
    responsive: true, maintainAspectRatio: false, parsing: false,
    scales: {
      x: { type: "linear", ticks: { color: css("--muted"), stepSize: 2, callback: (v) => String(v) }, grid: { color: css("--line") } },
      y: { title: { display: true, text: cur.units, color: css("--muted") }, ticks: { color: css("--muted") }, grid: { color: css("--line") } },
    },
    plugins: { legend: { labels: { color: css("--text") } },
      tooltip: { callbacks: { label: (ctx) => `${ctx.raw.x}: ${ctx.raw.y == null ? "gap" : Number(ctx.raw.y).toFixed(2)} ${cur.units}` } } },
  };
  if (state.chart) state.chart.destroy();
  state.chart = new Chart($("chart"), { type: "line", data, options });
}

function renderVerdict() {
  const s = state.current.stats;
  if (s.error) { $("verdict").innerHTML = `<h3>Is it really changing?</h3><p>${esc(s.error)}</p>`; return; }
  const u = state.current.perDecadeUnit;
  $("verdict").innerHTML = `
    <h3>Is it really changing?</h3>
    <div class="big ${s.significant ? "yes" : "no"}">${s.significant ? "✅ Yes, significant" : "➖ Not significant"}</div>
    <div class="hint">${s.significant ? `Trend is ${esc(s.trend)}.` : "The change could be random year-to-year variation."}
      Mann-Kendall test${s.seasonal ? " (seasonal)" : ""}, α = ${s.alpha}.</div>
    <div class="stats">
      <div class="stat"><b>${fmtP(s.p_value)}</b><span>p-value</span></div>
      <div class="stat"><b>${fmt(s.slope_per_decade)}</b><span>Sen's slope, ${esc(u)} per decade</span></div>
      <div class="stat"><b>${fmt(s.total_change)}</b><span>total change ${Math.floor(s.start)}–${Math.floor(s.end)}</span></div>
      <div class="stat"><b>${s.n}</b><span>${state.current.kind === "water" ? "years measured" : "monthly values"}</span></div>
    </div>`;
}

// ---------------------------------------------------------------- where (trend grid)
$("map-btn").addEventListener("click", async () => {
  const c = currentCase();
  const v = state.variables.find((x) => x.id === state.varId);
  if (!c || !v) return;
  const [s, w, n, e] = c.bbox;
  $("map-btn").disabled = true;
  $("map").innerHTML = `<p class="faint">Running 16 trend tests on NASA POWER data…</p>`;
  try {
    const g = await api(`/api/trend/grid?var=${v.id}&bbox=${w},${s},${e},${n}&n=4`);
    const latest = state.scan?.caseId === c.id ? state.scan.years.filter((y) => y.status === "ok").at(-1) : null;
    const img = latest?.imageUrl ||
      `https://wvs.earthdata.nasa.gov/api/v1/snapshot?REQUEST=GetSnapshot&CRS=EPSG:4326&FORMAT=image/jpeg&TIME=2025-08-20&BBOX=${c.bbox.join(",")}&WIDTH=800&HEIGHT=640&LAYERS=MODIS_Terra_CorrectedReflectance_TrueColor`;
    const max = Math.max(...g.features.map((f) => Math.abs(f.properties.slope_per_decade || 0)), 1e-9);
    // features run south→north; draw rows north→south
    const rows = [];
    for (let j = 3; j >= 0; j--) rows.push(...g.features.slice(j * 4, j * 4 + 4));
    const cells = rows.map((f) => {
      const p = f.properties, k = (p.slope_per_decade || 0) / max;
      const col = k >= 0 ? `rgba(255,107,129,${0.15 + 0.5 * k})` : `rgba(79,179,255,${0.15 + 0.5 * -k})`;
      return `<div class="cell ${p.significant ? "sig" : ""}" style="background:${col}" title="p ${fmtP(p.p_value)}">${fmt(p.slope_per_decade)}</div>`;
    }).join("");
    $("map").innerHTML = `<img src="${img}" alt="NASA MODIS image of ${esc(c.name)}"><div class="cells" style="grid-template-columns:repeat(4,1fr)">${cells}</div>`;
    const sm = g.summary;
    $("map-legend").innerHTML = `Numbers are ${esc(v.name)} change in ${esc(v.units)} per decade. Red = rising, blue = falling.
      <b>${sm.significant_cells} of ${sm.cells}</b> cells are statistically significant (yellow outline).`;
  } catch (err) {
    $("map").innerHTML = "";
    toast(`Map failed: ${err.message}`);
  } finally {
    $("map-btn").disabled = false;
  }
});

// ---------------------------------------------------------------- time machine
document.addEventListener("scan:done", (e) => renderTimeMachine(e.detail));
function renderTimeMachine(r) {
  const ok = r.years.filter((y) => y.status === "ok");
  if (ok.length < 2) return;
  const a = ok[0], b = ok.at(-1);
  $("tm-body").hidden = false;
  $("tm-go").hidden = true;
  $("tm-title").textContent = `Time Machine · ${r.name}`;
  $("tm-hint").textContent = "Drag the slider to swipe between the first and latest measured year.";
  $("tm-before").src = a.imageUrl;
  $("tm-after").src = b.imageUrl;
  $("tm-left").textContent = `${a.year} · ${a.waterPct}% water`;
  $("tm-right").textContent = `${b.year} · ${b.waterPct}% water`;
  $("tm-note").textContent = `🕵️ Detective note: ${r.finding}`;
  const yr = $("tm-year");
  yr.max = r.years.length - 1;
  yr.value = r.years.length - 1;
  yr.oninput = () => showYear(r.years[+yr.value]);
  showYear(r.years.at(-1));
  setSwipe(50);
}
function showYear(y) {
  $("tm-year-label").textContent = y.year;
  $("tm-year-water").textContent = y.status === "ok" ? `${y.waterPct}% water · ${y.date}` : `${y.status}: not measured (gap)`;
  $("tm-single").src = y.imageUrl;
  $("tm-single").style.display = "block";
}
function setSwipe(v) {
  $("tm-before-wrap").style.clipPath = `inset(0 ${100 - v}% 0 0)`;
  $("tm-handle").style.left = `${v}%`;
}
$("tm-go").addEventListener("click", () => go("scan"));
$("tm-swipe").addEventListener("input", (e) => setSwipe(+e.target.value));

// ---------------------------------------------------------------- feed + solutions
let events = [];
document.addEventListener("scan:done", () => renderFeed());
async function loadEvents() {
  try { events = await api("/api/events"); } catch (err) { toast(`Live NASA events failed: ${err.message}`); }
  renderFeed();
}
function renderFeed() {
  const posts = [];
  const r = state.scan;
  if (r) {
    const last = r.years.filter((y) => y.status === "ok").at(-1);
    posts.push(`<article class="post">
      <div class="head"><div class="who"><b>@detective_scan</b><span>${esc(r.name)} · scanned ${esc(r.scannedAt.slice(0, 16).replace("T", " "))} UTC</span></div><span class="badge">NEW TREND</span></div>
      <img src="${last.imageUrl}" alt="NASA image of ${esc(r.name)} in ${last.year}" loading="lazy">
      <div class="body"><p>${esc(r.finding)}</p>
        <div class="meta">${r.stats.p_value != null ? `p ${fmtP(r.stats.p_value)} · Sen's slope ${fmt(r.stats.slope_per_decade)} points/decade · ` : ""}${esc(r.source)}</div>
        <details class="info"><summary>ⓘ NASA sources</summary>
          <a href="https://worldview.earthdata.nasa.gov/?l=MODIS_Terra_CorrectedReflectance_TrueColor&t=${last.date}" target="_blank" rel="noopener">Open in Worldview</a> ·
          <a href="https://earthobservatory.nasa.gov/world-of-change" target="_blank" rel="noopener">Earth Observatory: World of Change</a></details>
      </div>${solutionsBox(`scan-${r.caseId}`)}</article>`);
  }
  for (const e of events) {
    posts.push(`<article class="post">
      <div class="head"><div class="who"><b>@nasa_eonet</b><span>${esc(e.category)} · ${esc(e.date)}</span></div><span class="badge live">LIVE</span></div>
      <img src="${e.thumbUrl}" alt="NASA image near ${esc(e.title)}" loading="lazy" onerror="this.style.display='none'">
      <div class="body"><p><b>${esc(e.title)}</b></p>
        <div class="meta">${e.lat.toFixed(2)}, ${e.lon.toFixed(2)}${e.magnitude ? ` · ${esc(e.magnitude)}` : ""}</div>
        <details class="info"><summary>ⓘ NASA sources</summary><a href="${esc(e.link)}" target="_blank" rel="noopener">EONET record</a> ·
          <a href="https://worldview.earthdata.nasa.gov/?t=${e.date}" target="_blank" rel="noopener">Worldview</a></details>
      </div>${solutionsBox(e.id)}</article>`);
  }
  $("feed").innerHTML = posts.join("") || `<p class="faint">No posts yet. Run a scan, or check your connection for live NASA events.</p>`;
  $("feed").querySelectorAll(".sol").forEach(wireSolutions);
}

const SOL_KEY = "earth-detective:solutions:v1";
function loadSol() { try { return JSON.parse(localStorage.getItem(SOL_KEY)) || {}; } catch { return {}; } }
function saveSol(all) { try { localStorage.setItem(SOL_KEY, JSON.stringify(all)); } catch { /* storage blocked */ } }
function solutionsBox(id) {
  return `<details class="sol" data-id="${esc(id)}"><summary>💡 Solutions</summary>
    <form><input type="text" maxlength="200" placeholder="Your idea to help…" required>
      <select><option>Before</option><option>During</option><option>After</option></select>
      <button class="btn-ghost">Add</button></form><ul></ul></details>`;
}
function wireSolutions(box) {
  const id = box.dataset.id;
  const list = box.querySelector("ul");
  const draw = () => {
    const items = (loadSol()[id] || []).slice().sort((a, b) => b.votes - a.votes);
    list.innerHTML = items.map((s, i) => `<li><span class="t">${esc(s.text)}</span><span class="when">${esc(s.when)}</span>
      <button class="btn-ghost" data-i="${s.created}">▲ ${s.votes}</button></li>`).join("") ||
      `<li class="faint">No ideas yet. Add the first one.</li>`;
    list.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      const all = loadSol();
      const it = (all[id] || []).find((x) => String(x.created) === b.dataset.i);
      if (it) { it.votes++; saveSol(all); draw(); }
    }));
  };
  box.querySelector("form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const input = box.querySelector("input");
    const all = loadSol();
    (all[id] ||= []).push({ text: input.value.trim(), when: box.querySelector("select").value, votes: 0, created: Date.now() });
    saveSol(all);
    input.value = "";
    draw();
  });
  draw();
}

// ---------------------------------------------------------------- start
(async function init() {
  try {
    [state.cases, state.variables] = await Promise.all([api("/api/cases"), api("/api/variables")]);
  } catch (err) {
    $("terminal").innerHTML = `<div class="k-warn">✗ Can't reach the Python backend (${esc(err.message)}). Start it with: cd backend && uvicorn main:app --port 8000, then open http://localhost:8000</div>`;
    return;
  }
  renderPlaces();
  renderVariables();
  loadEvents();
})();
