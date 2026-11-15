// P2 · js/chart.js — water-by-year chart + finding card. Listens for "scan:done" only.
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const niceDate = (d) => { const [, m, day] = d.split("-"); return `${+day} ${MONTHS[+m - 1]}`; };
const isMock = (r) => r.mock === true || !!r._mock || /mock/i.test(r.source || "");
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let chart = null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function renderChart(result, container) {
  if (!container) return;
  if (chart) { chart.destroy(); chart = null; }
  container.replaceChildren();

  const years = result.years;
  const measured = years.filter((y) => y.status === "ok" && y.waterPct != null);
  const skipped = years.length - measured.length;
  const estimated = measured.some((y) => y.estimated);

  // ---- chart block
  const wrap = el("div", "scan-chart-wrap");
  const canvas = el("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", result.finding);
  wrap.append(canvas);
  const legend = el("p", "scan-legend");
  legend.append(
    el("span", "dot dot-filled"), " measured  ",
    el("span", "dot dot-hollow"), " estimate  ",
    el("span", "dot dot-red"), " biggest drop  ",
    "☁ cloudy year (skipped)"
  );
  container.append(wrap, legend);

  const cBlue = cssVar("--cyan"), cRed = cssVar("--red"), cMuted = cssVar("--muted"),
        cLine = cssVar("--line"), cCard = cssVar("--card"), cText = cssVar("--text"), cYellow = cssVar("--yellow");

  const mainData = years.map((y) => ({ x: y.year, y: y.status === "ok" ? y.waterPct : null }));
  const bd = result.biggestDrop;
  const byYear = Object.fromEntries(years.map((y) => [y.year, y]));
  const dropData = bd && byYear[bd.from]?.waterPct != null && byYear[bd.to]?.waterPct != null
    ? [{ x: bd.from, y: byYear[bd.from].waterPct }, { x: bd.to, y: byYear[bd.to].waterPct }] : [];

  const normal = years.filter((y) => y.year >= 2000 && y.year <= 2005 && y.status === "ok" && y.waterPct != null).map((y) => y.waterPct);
  const band = normal.length ? { min: Math.min(...normal), max: Math.max(...normal) } : null;

  const yMax = Math.max(...measured.map((y) => y.waterPct), 1);
  const progress = { v: reduced() ? 1 : 0 };

  const decorations = {
    id: "scanDecor",
    beforeDatasetsDraw(c) {
      const { ctx, chartArea: a, scales: { x, y } } = c;
      if (band) {
        const x0 = x.getPixelForValue(2000), x1 = x.getPixelForValue(2005);
        const y0 = y.getPixelForValue(band.max), y1 = y.getPixelForValue(band.min);
        ctx.save();
        ctx.fillStyle = cBlue; ctx.globalAlpha = 0.12;
        ctx.fillRect(x0, y0, x1 - x0, Math.max(y1 - y0, 2));
        ctx.globalAlpha = 1; ctx.fillStyle = cMuted; ctx.font = "11px " + cssVar("--font");
        ctx.textAlign = "left"; ctx.fillText("normal", x0 + 4, y0 - 4);
        ctx.restore();
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(a.left - 8, a.top - 8, (a.right - a.left + 16) * progress.v, a.bottom - a.top + 16);
      ctx.clip();
    },
    afterDatasetsDraw(c) {
      const { ctx, chartArea: a, scales: { x, y } } = c;
      ctx.restore();
      // cloudy markers on the axis
      ctx.save(); ctx.fillStyle = cMuted; ctx.font = "12px " + cssVar("--font"); ctx.textAlign = "center";
      years.filter((yr) => yr.status !== "ok" || yr.waterPct == null)
        .forEach((yr) => ctx.fillText("☁", x.getPixelForValue(yr.year), a.bottom - 6));
      ctx.restore();
      // biggest-drop label
      if (dropData.length && progress.v > 0.98) {
        const mx = x.getPixelForValue((dropData[0].x + dropData[1].x) / 2);
        const my = y.getPixelForValue((dropData[0].y + dropData[1].y) / 2);
        const text = `Biggest drop: ${bd.from} → ${bd.to}`;
        ctx.save(); ctx.font = "600 12px " + cssVar("--font"); ctx.fillStyle = cRed;
        const w = ctx.measureText(text).width;
        const tx = Math.min(Math.max(mx + 10, a.left + 4), a.right - w - 4);
        ctx.textAlign = "left"; ctx.fillText(text, tx, my - 8);
        ctx.restore();
      }
    },
  };

  chart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Water", data: mainData, spanGaps: false,
          borderColor: cBlue, backgroundColor: cBlue, borderWidth: 2.5, tension: 0.15,
          pointRadius: 4.5, pointHoverRadius: 6, pointBorderWidth: 2, pointBorderColor: cBlue,
          pointBackgroundColor: years.map((y) => (y.estimated ? cCard : cBlue)),
        },
        {
          label: "Biggest drop", data: dropData, borderColor: cRed, backgroundColor: cRed,
          borderWidth: 4.5, pointRadius: 0, pointHoverRadius: 0, spanGaps: false,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "nearest", intersect: true },
      layout: { padding: { right: 8 } },
      scales: {
        x: { type: "linear", min: years[0].year - 0.5, max: years[years.length - 1].year + 0.5,
             ticks: { color: cMuted, stepSize: 2, callback: (v) => (Number.isInteger(v) ? v : "") },
             grid: { color: cLine } },
        y: { min: 0, suggestedMax: Math.ceil(yMax * 1.15),
             title: { display: true, text: "Water, % of area", color: cMuted },
             ticks: { color: cMuted, callback: (v) => v + "%" }, grid: { color: cLine } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (i) => i.datasetIndex === 0,
          backgroundColor: cCard, borderColor: cLine, borderWidth: 1, titleColor: cText, bodyColor: cText,
          displayColors: false,
          callbacks: {
            title: () => "",
            label: (i) => {
              const y = byYear[i.raw.x];
              return `${y.year} · ${y.waterPct.toFixed(1)}% water · NASA MODIS Terra, ${niceDate(y.date)}${y.estimated ? " (estimate)" : ""}`;
            },
          },
        },
      },
    },
    plugins: [decorations],
  });

  // draw-in animation
  if (!reduced()) {
    const t0 = performance.now(), dur = 1600;
    const tick = (t) => {
      progress.v = Math.min((t - t0) / dur, 1);
      progress.v = 1 - Math.pow(1 - progress.v, 3);
      chart && chart.draw();
      if (progress.v < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ---- finding card
  const card = el("section", "card finding-card");
  const tags = el("div", "finding-tags");
  if (isMock(result)) tags.append(el("span", "tag tag-mock", "MOCK DATA"));
  if (estimated) tags.append(el("span", "tag tag-est", "Some values are estimates"));
  if (tags.childElementCount) card.append(tags);

  const pct = result.changePct;
  const big = el("div", "finding-big", `${pct > 0 ? "+" : "−"}${Math.abs(Math.round(pct))}%`);
  card.append(big, el("p", "finding-text", result.finding));

  const chips = el("div", "chips");
  chips.append(
    el("span", "chip", `📅 ${result.first.year} → ${result.latest.year}`),
    el("span", "chip", `🛰️ ${measured.length} images measured`),
    el("span", "chip", `☁ ${skipped} year${skipped === 1 ? "" : "s"} skipped`)
  );
  card.append(chips);

  const actions = el("div", "finding-actions");
  const go = (tab) => document.dispatchEvent(new CustomEvent("nav:go", { detail: { tab } }));
  const b1 = el("button", "btn", "🕰️ Open Time Machine"); b1.type = "button"; b1.onclick = () => go("time");
  const b2 = el("button", "btn btn-ghost", "📰 See it in the feed"); b2.type = "button"; b2.onclick = () => go("feed");
  actions.append(b1, b2);
  card.append(actions);
  container.append(card);
}

document.addEventListener("scan:done", (e) => renderChart(e.detail, document.getElementById("chart")));
