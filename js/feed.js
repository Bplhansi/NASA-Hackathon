
/*
 * EARTH DETECTIVE — P3
 * NASA Earth Feed
 */

import { fetchEvents } from "./nasa.js";

const feedRoot = document.getElementById("feed");

let events = [];
let latestScan = null;
let activeFilter = "all";
let loading = true;
let loadError = "";

// Prevent external NASA text from being treated as HTML.
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol)
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function categoryInfo(category = "") {
  const name = category.toLowerCase();

  if (name.includes("wildfire")) {
    return { type: "wildfire", icon: "🔥", label: "Wildfires" };
  }
  if (name.includes("storm") || name.includes("cyclone")) {
    return { type: "storm", icon: "🌀", label: "Storms" };
  }
  if (name.includes("volcano")) {
    return { type: "volcano", icon: "🌋", label: "Volcanoes" };
  }
  if (name.includes("ice")) {
    return { type: "ice", icon: "🧊", label: "Ice" };
  }
  if (name.includes("flood")) {
    return { type: "flood", icon: "🌊", label: "Floods" };
  }

  return { type: "other", icon: "🌎", label: category || "Earth event" };
}

const filters = [
  ["all", "🌎 All"],
  ["finding", "🕵️ Findings"],
  ["wildfire", "🔥 Wildfires"],
  ["storm", "🌀 Storms"],
  ["volcano", "🌋 Volcanoes"],
  ["ice", "🧊 Ice"],
  ["flood", "🌊 Floods"]
];

function renderFilters() {
  return `
    <div class="feed-filters" aria-label="Filter events">
      ${filters.map(([id, label]) => `
        <button
          type="button"
          class="filter-chip ${activeFilter === id ? "active" : ""}"
          data-filter="${id}"
          aria-pressed="${activeFilter === id}"
        >${label}</button>
      `).join("")}
    </div>
  `;
}

function renderScanCard(result) {
  const years = Array.isArray(result.years) ? result.years : [];
  const images = years.filter((year) => year.imageUrl);
  const first = images[0];
  const latest = images[images.length - 1];

  const hasEstimates = years.some((year) => year.estimated);
  const measured = years.filter(
    (year) => year.status === "ok" && !year.estimated
  ).length;

  const change = Number(result.changePct);
  const changeText = Number.isFinite(change)
    ? `${change > 0 ? "+" : ""}${change.toFixed(1)}%`
    : "Trend investigated";

  return `
    <article class="feed-card">
      ${latest?.imageUrl ? `
        <img
          class="feed-card-image"
          src="${escapeHTML(safeUrl(latest.imageUrl))}"
          alt="Satellite view of ${escapeHTML(result.name)}"
          loading="lazy"
        >
      ` : ""}

      <div class="feed-card-body">
        <div class="feed-meta">🕵️ @detective_scan · INVESTIGATION</div>

        <h3>${escapeHTML(result.name)} — ${escapeHTML(changeText)}</h3>

        <p>${escapeHTML(
          result.finding || "Investigation completed."
        )}</p>

        <p class="feed-meta">
          ${measured} measured observations
          ${hasEstimates ? " · Contains estimates" : ""}
          · ${escapeHTML(result.source || "NASA imagery")}
        </p>

        ${first?.year && latest?.year ? `
          <p class="feed-meta">
            ${escapeHTML(first.year)} → ${escapeHTML(latest.year)}
          </p>
        ` : ""}

        <div class="feed-actions">
          <button type="button" class="btn"
            data-action="time">🕰️ Time Machine</button>
          <button type="button" class="btn btn-ghost"
            data-action="solutions"
            data-id="${escapeHTML(`scan-${result.caseId}`)}"
            data-title="${escapeHTML(result.name)}">
            💡 Solutions
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderEventCard(event) {
  const category = categoryInfo(event.category);

  return `
    <article class="feed-card">
      ${event.thumbUrl ? `
        <img
          class="feed-card-image"
          src="${escapeHTML(safeUrl(event.thumbUrl))}"
          alt="NASA satellite view near ${escapeHTML(event.title)}"
          loading="lazy"
        >
      ` : ""}

      <div class="feed-card-body">
        <div class="feed-meta">
          ${category.icon} ${escapeHTML(category.label)}
          · NASA EONET
        </div>

        <h3>${escapeHTML(event.title)}</h3>

        <p class="feed-meta">
          📅 ${escapeHTML(event.date)}
          ${event.magnitude
            ? ` · ${escapeHTML(event.magnitude)}`
            : ""}
        </p>

        <p class="feed-meta">
          📍 ${Number(event.lat).toFixed(2)}°,
          ${Number(event.lon).toFixed(2)}°
        </p>

        <div class="feed-actions">
          <button type="button" class="btn btn-ghost"
            data-action="info"
            data-id="${escapeHTML(event.id)}">
            ⓘ Details
          </button>

          <button type="button" class="btn"
            data-action="solutions"
            data-id="${escapeHTML(event.id)}"
            data-title="${escapeHTML(event.title)}">
            💡 Solutions
          </button>
        </div>
      </div>
    </article>
  `;
}

export function renderFeed() {
  if (!feedRoot) return;

  const visibleEvents = events.filter((event) => {
    return activeFilter === "all" ||
      categoryInfo(event.category).type === activeFilter;
  });

  const showScan = latestScan &&
    (activeFilter === "all" || activeFilter === "finding");

  const cards = [
    showScan ? renderScanCard(latestScan) : "",
    ...visibleEvents.map(renderEventCard)
  ].filter(Boolean);

  feedRoot.innerHTML = `
    ${renderFilters()}

    ${loading ? `
      <div class="card">
        🛰️ Contacting NASA EONET...
      </div>
    ` : ""}

    ${loadError ? `
      <div class="card">
        <p>NASA events couldn't be loaded right now.</p>
        <button type="button" class="btn"
          data-action="retry">Try again</button>
      </div>
    ` : ""}

    ${!latestScan && activeFilter === "all" ? `
      <div class="card">
        <p>🕵️ Run a Detective Scan to publish your
        investigation findings here.</p>
      </div>
    ` : ""}

    <div class="feed-grid">
      ${cards.join("")}
    </div>

    ${!loading && cards.length === 0 ? `
      <div class="card">
        <p class="empty-state">
          No events in this category right now.
        </p>
      </div>
    ` : ""}

    <p class="helper-text">
      Events come from NASA EONET. Satellite thumbnails
      show nearby imagery and are not necessarily images
      of the event itself.
    </p>
  `;
}

export async function loadFeed() {
  loading = true;
  loadError = "";
  renderFeed();

  try {
    events = await fetchEvents();
  } catch (error) {
    console.error("EONET feed error:", error);
    loadError = String(error.message || error);
  } finally {
    loading = false;
    renderFeed();
  }
}

function openInfo(event) {
  const root = document.getElementById("modal-root");
  if (!root) return;

  const info = categoryInfo(event.category);

  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-sheet" role="dialog"
        aria-modal="true" aria-label="Event details">
        <button class="modal-close" type="button"
          aria-label="Close">×</button>

        <p class="eyebrow">${info.icon} NASA EONET</p>
        <h2>${escapeHTML(event.title)}</h2>

        <p><strong>Category:</strong>
          ${escapeHTML(event.category)}</p>
        <p><strong>Latest recorded date:</strong>
          ${escapeHTML(event.date)}</p>
        <p><strong>Coordinates:</strong>
          ${Number(event.lat).toFixed(2)},
          ${Number(event.lon).toFixed(2)}</p>

        <p>
          EONET tracks natural events using reports
          from multiple sources. Event records do not
          necessarily indicate that an event is still active
          at this exact moment.
        </p>

        <a href="${escapeHTML(safeUrl(event.link))}"
          target="_blank" rel="noopener noreferrer">
          View NASA EONET event ↗
        </a>
      </div>
    </div>
  `;

  root.querySelector(".modal-close")
    ?.addEventListener("click", () => root.replaceChildren());

  root.querySelector(".modal-backdrop")
    ?.addEventListener("click", (e) => {
      if (e.target.classList.contains("modal-backdrop")) {
        root.replaceChildren();
      }
    });
}

// Clicking cards and filters
feedRoot?.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  if (button.dataset.filter) {
    activeFilter = button.dataset.filter;
    renderFeed();
    return;
  }

  const action = button.dataset.action;

  if (action === "retry") {
    await loadFeed();
  }

  if (action === "time") {
    document.dispatchEvent(new CustomEvent("nav:go", {
      detail: { tab: "time" }
    }));
  }

  if (action === "info") {
    const item = events.find((e) =>
      String(e.id) === button.dataset.id
    );
    if (item) openInfo(item);
  }

  if (action === "solutions") {
    // The next file, solutions.js, will handle this.
    document.dispatchEvent(new CustomEvent("solutions:open", {
      detail: {
        cardId: button.dataset.id,
        title: button.dataset.title
      }
    }));
  }
});

// When P1 completes a scan, show its findings in the feed.
document.addEventListener("scan:done", (event) => {
  latestScan = event.detail;
  renderFeed();
});
