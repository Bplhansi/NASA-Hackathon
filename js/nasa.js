// js/nasa.js (P1) — NASA Worldview snapshot URLs, image loading, EONET fetch.
// No API keys. Both services send Access-Control-Allow-Origin: *.

const SNAPSHOT_BASE = "https://wvs.earthdata.nasa.gov/api/v1/snapshot";
const EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=20&limit=20";

/** Worldview snapshot URL for a bbox [latMin, lonMin, latMax, lonMax] on a YYYY-MM-DD date. */
export function snapshotUrl(bbox, date, { width = 800, height = 640,
  layer = "MODIS_Terra_CorrectedReflectance_TrueColor" } = {}) {
  const params = new URLSearchParams({
    REQUEST: "GetSnapshot",
    CRS: "EPSG:4326",
    FORMAT: "image/jpeg",
    TIME: date,
    BBOX: bbox.map((n) => +(+n).toFixed(4)).join(","),
    WIDTH: String(width),
    HEIGHT: String(height),
    LAYERS: layer,
  });
  // URLSearchParams encodes "," and ":" — the API accepts both forms, but keep it readable.
  return `${SNAPSHOT_BASE}?${params.toString().replace(/%2C/g, ",").replace(/%3A/g, ":").replace(/%2F/g, "/")}`;
}

/** Load an image with CORS enabled so a canvas can read its pixels. Rejects after `timeoutMs`. */
export function loadImage(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // must be set BEFORE src
    const timer = setTimeout(() => {
      img.src = "";
      reject(new Error(`Timed out loading ${url}`));
    }, timeoutMs);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error(`Failed to load ${url}`)); };
    img.src = url;
  });
}

const isPlannedBurn = (title) => /\bRX\b/i.test(title) || /^prescribed/i.test(title);

/** Live natural events from NASA EONET, shaped like contract §6.4. Newest first. */
export async function fetchEvents() {
  const res = await fetch(EONET_URL);
  if (!res.ok) throw new Error(`EONET returned ${res.status}`);
  const data = await res.json();

  const events = [];
  for (const ev of data.events || []) {
    const geoms = (ev.geometry || []).filter((g) => g && g.coordinates);
    if (!geoms.length) continue;
    // latest geometry point
    const g = geoms.reduce((a, b) => (new Date(b.date) > new Date(a.date) ? b : a));
    // Point → [lon, lat]; Polygon → [[[lon, lat], …]] — use the first vertex
    let coords = g.coordinates;
    while (Array.isArray(coords[0])) coords = coords[0];
    const [lon, lat] = coords;
    if (typeof lat !== "number" || typeof lon !== "number") continue;

    const date = String(g.date).slice(0, 10);
    const planned = isPlannedBurn(ev.title || "");
    events.push({
      id: ev.id,
      title: planned ? `${ev.title} (planned)` : ev.title,
      category: ev.categories?.[0]?.title || "Natural event",
      date,
      lat,
      lon,
      magnitude: g.magnitudeValue != null
        ? `${g.magnitudeValue} ${g.magnitudeUnit || ""}`.trim()
        : null,
      link: ev.link || `https://eonet.gsfc.nasa.gov/api/v3/events/${ev.id}`,
      thumbUrl: snapshotUrl([lat - 3, lon - 3, lat + 3, lon + 3], date, { width: 480, height: 360 }),
      planned,
    });
  }
  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return events;
}
