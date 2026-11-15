// P2 · js/timemachine.js — before/after swipe, year slider, play, detective note.
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const isMock = (r) => r.mock === true || !!r._mock || /mock/i.test(r.source || "");
let timer = null;

export function renderTimeMachine(result, container) {
  if (!container) return;
  clearInterval(timer);
  container.replaceChildren();

  const ok = result.years.filter((y) => y.status === "ok" && y.waterPct != null && y.imageUrl);
  if (ok.length < 2) { container.append(el("p", "tm-empty", "Not enough measured years to compare yet. Run a scan first.")); return; }
  const first = ok[0];
  let idx = ok.length - 1;

  // preload
  const cache = new Map();
  const load = (y) => {
    if (!cache.has(y.year)) cache.set(y.year, new Promise((res) => {
      const im = new Image(); im.crossOrigin = "anonymous";
      im.onload = () => res(true); im.onerror = () => res(false); im.src = y.imageUrl;
    }));
    return cache.get(y.year);
  };

  // stage
  const stage = el("div", "tm-stage");
  const imgRight = el("img", "tm-img"); imgRight.alt = ""; imgRight.draggable = false;
  const imgLeft = el("img", "tm-img tm-left"); imgLeft.alt = `${result.name} in ${first.year}`; imgLeft.draggable = false;
  imgLeft.src = first.imageUrl;
  const labL = el("span", "tm-label tm-label-l", String(first.year));
  const labR = el("span", "tm-label tm-label-r");
  const pctL = el("span", "tm-pct tm-pct-l", `${first.waterPct.toFixed(1)}% water`);
  const pctR = el("span", "tm-pct tm-pct-r");
  const divider = el("div", "tm-divider"); divider.tabIndex = 0;
  divider.setAttribute("role", "slider"); divider.setAttribute("aria-label", "Compare years");
  divider.setAttribute("aria-valuemin", "0"); divider.setAttribute("aria-valuemax", "100");
  divider.append(el("span", "tm-handle", "⇄"));
  const spinner = el("div", "tm-spinner"); spinner.setAttribute("aria-label", "Loading image");
  if (isMock(result)) stage.append(el("span", "tag tag-mock tm-mock", "MOCK DATA"));
  stage.append(imgRight, imgLeft, labL, labR, pctL, pctR, divider, spinner);

  let pos = 50;
  const setPos = (p) => {
    pos = Math.min(100, Math.max(0, p));
    imgLeft.style.clipPath = `inset(0 ${100 - pos}% 0 0)`;
    divider.style.left = pos + "%";
    divider.setAttribute("aria-valuenow", Math.round(pos));
  };
  const fromEvent = (e) => { const r = stage.getBoundingClientRect(); setPos(((e.clientX - r.left) / r.width) * 100); };
  stage.addEventListener("pointerdown", (e) => { stage.setPointerCapture(e.pointerId); fromEvent(e); stage.classList.add("dragging"); });
  stage.addEventListener("pointermove", (e) => { if (stage.hasPointerCapture(e.pointerId)) fromEvent(e); });
  const end = (e) => { stage.classList.remove("dragging"); if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId); };
  stage.addEventListener("pointerup", end); stage.addEventListener("pointercancel", end);
  divider.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { setPos(pos - 3); e.preventDefault(); }
    if (e.key === "ArrowRight") { setPos(pos + 3); e.preventDefault(); }
  });
  setPos(50);

  // controls
  const controls = el("div", "tm-controls");
  const playBtn = el("button", "btn tm-play", "▶ Play"); playBtn.type = "button";
  const slider = el("input", "tm-range"); slider.type = "range"; slider.min = 0; slider.max = ok.length - 1; slider.step = 1; slider.value = idx;
  slider.setAttribute("aria-label", "Year");
  const readout = el("div", "tm-readout");
  controls.append(playBtn, slider);

  async function show(i) {
    idx = i; slider.value = i;
    const y = ok[i];
    labR.textContent = y.year;
    pctR.textContent = `${y.waterPct.toFixed(1)}% water${y.estimated ? " (estimate)" : ""}`;
    const delta = y.waterPct - first.waterPct;
    readout.textContent = i === 0 ? `${y.year}: the starting point, ${y.waterPct.toFixed(1)}% water`
      : `${y.year}: ${y.waterPct.toFixed(1)}% water, ${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)} points vs ${first.year}`;
    const need = Promise.all([load(first), load(y)]);
    const t = setTimeout(() => stage.classList.add("loading"), 120);
    await need; clearTimeout(t);
    if (idx !== i) return;
    imgRight.src = y.imageUrl;
    stage.classList.remove("loading");
  }
  slider.addEventListener("input", () => { stop(); show(+slider.value); });

  const stop = () => { clearInterval(timer); timer = null; playBtn.textContent = "▶ Play"; };
  playBtn.onclick = () => {
    if (timer) return stop();
    playBtn.textContent = "⏸ Pause";
    let i = idx >= ok.length - 1 ? 0 : idx;
    show(i);
    timer = setInterval(() => { i++; if (i >= ok.length) return stop(); show(i); }, 600);
  };

  // detective note
  const note = el("section", "card tm-note");
  note.append(el("h3", "", "🕵️ Detective note"), el("p", "", result.finding),
    el("p", "tm-source", "Source: NASA Worldview · MODIS Terra"));
  const links = el("p", "tm-links");
  for (const [label, href] of [["worldview.earthdata.nasa.gov", "https://worldview.earthdata.nasa.gov"], ["earthobservatory.nasa.gov", "https://earthobservatory.nasa.gov"]]) {
    const a = el("a", "", label); a.href = href; a.target = "_blank"; a.rel = "noopener"; links.append(a, " ");
  }
  note.append(links);

  container.append(el("h2", "tm-title", `${result.name}: ${first.year} vs ${result.latest.year}`), stage, controls, readout, note);
  stage.classList.add("loading");
  Promise.all([load(first), load(ok[ok.length - 1])]).then(() => show(idx));
  // warm the rest in the background
  ok.forEach((y) => load(y));
}

document.addEventListener("scan:done", (e) =>
  renderTimeMachine(e.detail, document.getElementById("timemachine") || document.getElementById("time")));
