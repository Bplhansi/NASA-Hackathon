"""Earth Detective backend (NASA Space Apps 2026, "Be An Earth System Trend Detective!").

What it does
  * /api/scan/{case}   measures lake water area from real NASA MODIS images, 2000 -> today
  * /api/trend         monthly NASA POWER series (MERRA-2 / CERES) for a point + trend stats
  * /api/trend/grid    the same trend for an n x n grid over a box ("where is it changing?")
  * /api/compare       several variables at one point
  * /api/events        live natural events from NASA EONET
Every trend gets a Mann-Kendall significance test (p-value) and a Sen's slope (how much).

Data: NASA Worldview Snapshots (MODIS Terra), NASA POWER, NASA EONET. Free, no API keys.
Run:  pip install -r requirements.txt  then  uvicorn main:app --port 8000   (from backend/)
App:  http://localhost:8000/    Docs: http://localhost:8000/docs
"""
import asyncio
import hashlib
import io
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image

from trends import analyse

ROOT = Path(__file__).parent
CACHE = ROOT / "cache"
CACHE.mkdir(exist_ok=True)

POWER_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"
SNAPSHOT_URL = "https://wvs.earthdata.nasa.gov/api/v1/snapshot"
EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events"
FILL = -999.0
FIRST_YEAR = 2000          # MODIS Terra starts in 2000
POWER_LAST_YEAR = 2025     # last full year in NASA POWER monthly data
UA = {"User-Agent": "EarthDetective/1.0 (NASA Space Apps 2026 student project)"}

# ---------------------------------------------------------------- catalogue
CASES = [
    {"id": "aral", "name": "Aral Sea", "country": "Kazakhstan / Uzbekistan",
     "bbox": [43, 57.5, 47, 62.5], "monthDay": "08-20"},
    {"id": "urmia", "name": "Lake Urmia", "country": "Iran",
     "bbox": [37, 44.9, 38.5, 46.2], "monthDay": "08-20"},
    {"id": "mead", "name": "Lake Mead", "country": "USA",
     "bbox": [35.9, -115, 36.6, -114], "monthDay": "08-20"},
]
CASE_BY_ID = {c["id"]: c for c in CASES}

VARIABLES = {
    "T2M": {"name": "Air temperature at 2 m", "units": "°C", "source": "MERRA-2", "sphere": "atmosphere"},
    "T2M_MAX": {"name": "Maximum air temperature at 2 m", "units": "°C", "source": "MERRA-2", "sphere": "atmosphere"},
    "TS": {"name": "Earth skin (surface) temperature", "units": "°C", "source": "MERRA-2", "sphere": "land/ocean"},
    "PRECTOTCORR": {"name": "Precipitation (bias corrected)", "units": "mm/day", "source": "MERRA-2", "sphere": "hydrosphere"},
    "RH2M": {"name": "Relative humidity at 2 m", "units": "%", "source": "MERRA-2", "sphere": "atmosphere"},
    "QV2M": {"name": "Specific humidity at 2 m", "units": "g/kg", "source": "MERRA-2", "sphere": "atmosphere"},
    "WS10M": {"name": "Wind speed at 10 m", "units": "m/s", "source": "MERRA-2", "sphere": "atmosphere"},
    "PS": {"name": "Surface pressure", "units": "kPa", "source": "MERRA-2", "sphere": "atmosphere"},
    "GWETROOT": {"name": "Root zone soil wetness", "units": "0-1", "source": "MERRA-2", "sphere": "land"},
    "ALLSKY_SFC_SW_DWN": {"name": "All-sky surface shortwave radiation", "units": "kWh/m²/day", "source": "CERES / GEWEX", "sphere": "radiation"},
    "CLOUD_AMT": {"name": "Cloud amount", "units": "%", "source": "CERES / GEWEX", "sphere": "atmosphere"},
    "SNODP": {"name": "Snow depth", "units": "cm", "source": "MERRA-2", "sphere": "cryosphere"},
}

app = FastAPI(title="Earth Detective API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])


# ================================================================ NASA POWER
def _check(var, lat, lon, start, end):
    if var not in VARIABLES:
        raise HTTPException(400, f"unknown variable {var}; see /api/variables")
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(400, "lat/lon out of range")
    if not (1981 <= start < end <= POWER_LAST_YEAR):
        raise HTTPException(400, f"years must satisfy 1981 <= start < end <= {POWER_LAST_YEAR}")


async def fetch_series(client, var, lat, lon, start, end):
    """Monthly values from NASA POWER, cached on disk. Returns list of {date, t, month, value}."""
    lat, lon = round(lat, 2), round(lon, 2)
    key = hashlib.sha1(f"{var}|{lat}|{lon}|{start}|{end}".encode()).hexdigest()
    f = CACHE / f"power-{key}.json"
    if f.exists():
        raw = json.loads(f.read_text())
    else:
        params = {"parameters": var, "community": "AG", "latitude": lat, "longitude": lon,
                  "start": start, "end": end, "format": "JSON"}
        try:
            r = await client.get(POWER_URL, params=params, timeout=90)
            r.raise_for_status()
            raw = r.json()["properties"]["parameter"][var]
        except (httpx.HTTPError, KeyError, ValueError) as e:
            raise HTTPException(502, f"NASA POWER request failed: {e}")
        f.write_text(json.dumps(raw))
    out = []
    for k, v in sorted(raw.items()):
        month = int(k[4:])
        if month == 13:  # POWER adds an annual mean as month 13
            continue
        year = int(k[:4])
        out.append({"date": f"{year}-{month:02d}", "t": round(year + (month - 0.5) / 12, 4),
                    "month": month, "value": None if v == FILL else v})
    return out


def _stats(series, alpha, deseasonalise):
    return analyse([p["t"] for p in series], [p["value"] for p in series],
                   seasons=[p["month"] for p in series] if deseasonalise else None, alpha=alpha)


def _annual(series, stats):
    """Annual means (for a readable chart) and the Sen's slope line drawn through them."""
    by_year = {}
    for p in series:
        if p["value"] is not None:
            by_year.setdefault(int(p["date"][:4]), []).append(p["value"])
    annual = [{"year": y, "value": round(sum(v) / len(v), 4)}
              for y, v in sorted(by_year.items()) if len(v) == 12]
    line = None
    slope = stats.get("slope_per_year")
    if annual and slope is not None:
        offsets = sorted(a["value"] - slope * a["year"] for a in annual)
        b = offsets[len(offsets) // 2]
        line = [[annual[0]["year"], round(b + slope * annual[0]["year"], 4)],
                [annual[-1]["year"], round(b + slope * annual[-1]["year"], 4)]]
    return annual, line


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/variables")
def variables():
    return [{"id": k, **v} for k, v in VARIABLES.items()]


@app.get("/api/timeseries")
async def timeseries(var: str, lat: float, lon: float, start: int = FIRST_YEAR, end: int = POWER_LAST_YEAR):
    _check(var, lat, lon, start, end)
    async with httpx.AsyncClient(headers=UA) as c:
        series = await fetch_series(c, var, lat, lon, start, end)
    return {"variable": {"id": var, **VARIABLES[var]}, "lat": lat, "lon": lon, "series": series}


@app.get("/api/trend")
async def trend(var: str, lat: float, lon: float, start: int = FIRST_YEAR, end: int = POWER_LAST_YEAR,
                alpha: float = Query(0.05, gt=0, lt=1), seasonal: bool = True):
    _check(var, lat, lon, start, end)
    async with httpx.AsyncClient(headers=UA) as c:
        series = await fetch_series(c, var, lat, lon, start, end)
    stats = _stats(series, alpha, seasonal)
    annual, line = _annual(series, stats)
    return {"variable": {"id": var, **VARIABLES[var]}, "lat": lat, "lon": lon,
            "source": f"NASA POWER · {VARIABLES[var]['source']} · monthly",
            "series": series, "annual": annual, "annual_trend_line": line, "stats": stats}


@app.get("/api/compare")
async def compare(vars: str, lat: float, lon: float, start: int = FIRST_YEAR, end: int = POWER_LAST_YEAR,
                  alpha: float = Query(0.05, gt=0, lt=1), seasonal: bool = True):
    ids = [v.strip() for v in vars.split(",") if v.strip()][:6]
    for v in ids:
        _check(v, lat, lon, start, end)
    async with httpx.AsyncClient(headers=UA) as c:
        all_series = await asyncio.gather(*(fetch_series(c, v, lat, lon, start, end) for v in ids))
    return {"lat": lat, "lon": lon, "results": [
        {"variable": {"id": v, **VARIABLES[v]}, "stats": _stats(s, alpha, seasonal)}
        for v, s in zip(ids, all_series)]}


@app.get("/api/trend/grid")
async def trend_grid(var: str, bbox: str = Query(..., description="west,south,east,north"),
                     n: int = Query(5, ge=2, le=8), start: int = FIRST_YEAR, end: int = POWER_LAST_YEAR,
                     alpha: float = Query(0.05, gt=0, lt=1), seasonal: bool = True):
    """Sample an n x n grid of points in the box and return a GeoJSON of trend cells."""
    try:
        w, s, e, nn = (float(x) for x in bbox.split(","))
    except ValueError:
        raise HTTPException(400, "bbox must be west,south,east,north")
    if not (w < e and s < nn):
        raise HTTPException(400, "bbox must have west < east and south < north")
    _check(var, s, w, start, end)
    _check(var, nn, e, start, end)
    dx, dy = (e - w) / n, (nn - s) / n
    cells = [(w + i * dx, s + j * dy) for j in range(n) for i in range(n)]
    sem = asyncio.Semaphore(6)  # be polite to the POWER API

    async def one(c, x0, y0):
        async with sem:
            series = await fetch_series(c, var, y0 + dy / 2, x0 + dx / 2, start, end)
        st = _stats(series, alpha, seasonal)
        return {"type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [[[x0, y0], [x0 + dx, y0], [x0 + dx, y0 + dy], [x0, y0 + dy], [x0, y0]]]},
                "properties": {k: st.get(k) for k in ("slope_per_decade", "p_value", "significant", "trend", "total_change", "percent_change", "mean")}}

    async with httpx.AsyncClient(headers=UA) as c:
        feats = await asyncio.gather(*(one(c, x, y) for x, y in cells))
    slopes = [f["properties"]["slope_per_decade"] for f in feats if f["properties"]["slope_per_decade"] is not None]
    sig = [f for f in feats if f["properties"]["significant"]]
    return {"type": "FeatureCollection", "variable": {"id": var, **VARIABLES[var]}, "features": feats,
            "summary": {"cells": len(feats), "significant_cells": len(sig),
                        "increasing": sum(f["properties"]["trend"] == "increasing" for f in feats),
                        "decreasing": sum(f["properties"]["trend"] == "decreasing" for f in feats),
                        "min_slope_per_decade": min(slopes, default=None),
                        "max_slope_per_decade": max(slopes, default=None)}}


# ================================================================ water scan (MODIS)
TRUE_LAYER = "MODIS_Terra_CorrectedReflectance_TrueColor"
IR_LAYER = "MODIS_Terra_CorrectedReflectance_Bands721"
RETRY_OFFSETS = [0, 7, -7]          # days: the date, then +7, then -7
GOOD_CLOUD_PCT = 10                 # accept a date straight away if it is this clear
LIMITS = {"maxCloudPct": 30, "maxNoDataPct": 20, "maxDarkSwir": 25}
MEASURE_WIDTH = 400
SCAN_SOURCE = "NASA Worldview · MODIS Terra true colour + bands 7-2-1"


def snapshot_url(bbox, day, width=800, height=640, layer=TRUE_LAYER):
    b = ",".join(str(round(float(x), 4)) for x in bbox)
    return (f"{SNAPSHOT_URL}?REQUEST=GetSnapshot&CRS=EPSG:4326&FORMAT=image/jpeg&TIME={day}"
            f"&BBOX={b}&WIDTH={width}&HEIGHT={height}&LAYERS={layer}")


def measure_water(true_bytes, ir_bytes):
    """Same rules as js/measure.js (see README "How the scan works")."""
    tc_img = Image.open(io.BytesIO(true_bytes)).convert("RGB")
    w0, h0 = tc_img.size
    scale = min(1, MEASURE_WIDTH / w0)
    size = (max(1, round(w0 * scale)), max(1, round(h0 * scale)))
    tc = np.asarray(tc_img.resize(size, Image.BILINEAR), dtype=np.int16)
    ir = np.asarray(Image.open(io.BytesIO(ir_bytes)).convert("RGB").resize(size, Image.BILINEAR), dtype=np.int16)
    nodata = tc.max(axis=2) < 12
    r, g, b = ir[..., 0], ir[..., 1], ir[..., 2]
    cloud = ~nodata & (r > 110) & (g > 190) & (b > 190)
    water = ~nodata & ~cloud & (r < 45) & (g < 70) & (b >= r)
    total = nodata.size
    with_data = total - int(nodata.sum())
    cloud_pct = round(100 * int(cloud.sum()) / total, 1)
    nodata_pct = round(100 * int(nodata.sum()) / total, 1)
    dark_swir = float(np.quantile(r, 0.003))
    hazy = dark_swir > LIMITS["maxDarkSwir"]
    return {
        "waterPct": round(100 * int(water.sum()) / with_data, 1) if with_data else None,
        "cloudPct": cloud_pct, "noDataPct": nodata_pct, "hazy": bool(hazy),
        "valid": bool(with_data > 0 and not hazy and cloud_pct <= LIMITS["maxCloudPct"]
                      and nodata_pct <= LIMITS["maxNoDataPct"]),
    }


async def _get_bytes(client, url):
    for attempt in range(3):
        try:
            r = await client.get(url, timeout=45)
            r.raise_for_status()
            if not r.headers.get("content-type", "").startswith("image"):
                raise httpx.HTTPError(f"not an image: {r.headers.get('content-type')}")
            return r.content
        except httpx.HTTPError:
            if attempt == 2:
                raise
            await asyncio.sleep(1.5 * (attempt + 1))


async def measure_date(client, case, day, sem):
    image_url = snapshot_url(case["bbox"], day)
    analysis_url = snapshot_url(case["bbox"], day, layer=IR_LAYER)
    f = CACHE / f"water-{case['id']}-{day}.json"
    base = {"date": day, "imageUrl": image_url, "analysisUrl": analysis_url}
    if f.exists():
        return {**base, **json.loads(f.read_text())}
    try:
        async with sem:
            tc, ir = await asyncio.gather(_get_bytes(client, image_url), _get_bytes(client, analysis_url))
        m = measure_water(tc, ir)
    except Exception:
        return {**base, "valid": False, "failed": True}
    f.write_text(json.dumps(m))
    return {**base, **m}


async def scan_year(client, case, year, sem, log):
    base = date.fromisoformat(f"{year}-{case['monthDay']}")
    today = datetime.now(timezone.utc).date()
    tries = []
    for i, off in enumerate(RETRY_OFFSETS):
        d = base + timedelta(days=off)
        if d >= today:
            continue
        m = await measure_date(client, case, d.isoformat(), sem)
        tries.append(m)
        if m.get("valid") and m["cloudPct"] <= GOOD_CLOUD_PCT:
            break
        if i + 1 < len(RETRY_OFFSETS):
            why = "image failed" if m.get("failed") else "hazy" if m.get("hazy") else f"{m['cloudPct']}% cloud"
            log.append({"text": f"☁ {year} {why}, trying {(base + timedelta(days=RETRY_OFFSETS[i + 1])).isoformat()}", "kind": "warn"})
    valid = sorted((t for t in tries if t.get("valid")), key=lambda t: t["cloudPct"])
    if valid:
        b = valid[0]
        return {"year": year, "date": b["date"], "imageUrl": b["imageUrl"], "analysisUrl": b["analysisUrl"],
                "waterPct": b["waterPct"], "cloudPct": b["cloudPct"], "status": "ok", "estimated": False}
    status = "cloudy" if any(not t.get("failed") for t in tries) else "failed"
    log.append({"text": f"✗ {year} skipped ({status}), shown as a gap", "kind": "warn"})
    first = tries[0] if tries else {"date": base.isoformat(), "imageUrl": snapshot_url(case["bbox"], base.isoformat())}
    return {"year": year, "date": first["date"], "imageUrl": first["imageUrl"], "waterPct": None,
            "status": status, "estimated": False}


def summarise(years):
    ok = [y for y in years if y["status"] == "ok" and y["waterPct"] is not None]
    first = {"year": ok[0]["year"], "waterPct": ok[0]["waterPct"]} if ok else None
    latest = {"year": ok[-1]["year"], "waterPct": ok[-1]["waterPct"]} if ok else None
    change = None
    if first and latest and len(ok) >= 2 and first["waterPct"] > 0:
        change = round((latest["waterPct"] - first["waterPct"]) / first["waterPct"] * 100, 1)
    drop = None
    for a, b in zip(ok, ok[1:]):
        d = round(b["waterPct"] - a["waterPct"], 1)
        if d < 0 and (drop is None or d < drop["deltaPct"]):
            drop = {"from": a["year"], "to": b["year"], "deltaPct": d}
    stats = analyse([y["year"] for y in ok], [y["waterPct"] for y in ok], seasons=None)
    return first, latest, change, drop, stats


def fmt_p(p):
    return "< 0.001" if p < 0.001 else f"= {p:.3f}"


def write_finding(first, latest, change, drop, stats, years):
    if change is None:
        return "Not enough clear satellite images to measure a trend for this place."
    pct = abs(round(change))
    if pct < 3:
        s = f"Water area stayed about the same between {first['year']} and {latest['year']}."
    elif change < 0:
        s = f"Water area is down {pct}% since {first['year']}."
    else:
        s = f"Water area is up {pct}% since {first['year']}."
    if drop and change < 0:
        s += f" The biggest single drop was {drop['from']} → {drop['to']}."
    if "p_value" in stats:
        if stats["significant"]:
            s += (f" The trend is statistically significant (Mann-Kendall p {fmt_p(stats['p_value'])}),"
                  f" about {stats['slope_per_decade']:+.1f} points of the image per decade.")
        else:
            s += f" The trend is not statistically significant (p {fmt_p(stats['p_value'])})."
    gaps = sum(y["status"] != "ok" for y in years)
    if gaps:
        s += f" {gaps} cloudy or missing year{'s were' if gaps > 1 else ' was'} left as gaps."
    return s


_scan_locks: dict[str, asyncio.Lock] = {}


@app.get("/api/cases")
def cases():
    return CASES


@app.get("/api/scan/{case_id}")
async def scan(case_id: str, rescan: bool = False):
    """Measure water % in a MODIS image for every year since 2000 and test the trend."""
    case = CASE_BY_ID.get(case_id)
    if not case:
        raise HTTPException(404, f"unknown place {case_id}; see /api/cases")
    if rescan:
        for f in CACHE.glob(f"water-{case_id}-*.json"):
            f.unlink()
    lock = _scan_locks.setdefault(case_id, asyncio.Lock())
    async with lock:
        today = datetime.now(timezone.utc).date().isoformat()
        last = datetime.now(timezone.utc).year
        year_list = [y for y in range(FIRST_YEAR, last + 1) if f"{y}-{case['monthDay']}" < today]
        log = [{"text": f"› Scanning {case['name']}, {FIRST_YEAR}–{year_list[-1]}…", "kind": "info"},
               {"text": f"› Source: {SCAN_SOURCE} · box {', '.join(map(str, case['bbox']))}", "kind": "info"}]
        sem = asyncio.Semaphore(8)
        async with httpx.AsyncClient(headers=UA, follow_redirects=True) as client:
            years = await asyncio.gather(*(scan_year(client, case, y, sem, log) for y in year_list))
        for y in years:
            if y["status"] == "ok":
                log.append({"text": f"⬇ NASA MODIS Terra · {y['date']} → water {y['waterPct']}% of image", "kind": "data"})
        if not any(y["status"] == "ok" for y in years):
            raise HTTPException(502, "No clear NASA images could be measured. Check the connection and try again.")
        first, latest, change, drop, stats = summarise(years)
        ok = sum(y["status"] == "ok" for y in years)
        log.append({"text": f"› {ok} of {len(years)} years measured", "kind": "info"})
        if "p_value" in stats:
            log.append({"text": f"∑ Mann-Kendall p {fmt_p(stats['p_value'])} → "
                                f"{'significant' if stats['significant'] else 'not significant'} · "
                                f"Sen's slope {stats['slope_per_decade']:+.2f} pts/decade", "kind": "data"})
        if change is not None:
            log.append({"text": f"⚠ Change detected: {'+' if change > 0 else '−'}{abs(round(change))}%",
                        "kind": "warn" if abs(change) >= 10 else "info"})
        log.append({"text": "✓ Case file ready", "kind": "ok"})
        trend_line = None
        if "slope_per_year" in stats:
            okv = [y for y in years if y["status"] == "ok"]
            offs = sorted(y["waterPct"] - stats["slope_per_year"] * y["year"] for y in okv)
            b = offs[len(offs) // 2]
            trend_line = [[okv[0]["year"], round(b + stats["slope_per_year"] * okv[0]["year"], 3)],
                          [okv[-1]["year"], round(b + stats["slope_per_year"] * okv[-1]["year"], 3)]]
        return {
            "caseId": case["id"], "name": case["name"], "country": case["country"], "bbox": case["bbox"],
            "source": SCAN_SOURCE, "years": years, "first": first, "latest": latest,
            "changePct": change, "biggestDrop": drop, "stats": stats, "trendLine": trend_line,
            "finding": write_finding(first, latest, change, drop, stats, years),
            "log": log, "scannedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }


# ================================================================ EONET
@app.get("/api/events")
async def events(days: int = Query(20, ge=1, le=90), limit: int = Query(20, ge=1, le=50)):
    """Live open natural events from NASA EONET, shaped like contract §6.4."""
    f = CACHE / "eonet.json"
    fresh = f.exists() and (datetime.now().timestamp() - f.stat().st_mtime) < 900
    if fresh:
        data = json.loads(f.read_text())
    else:
        try:
            async with httpx.AsyncClient(headers=UA) as c:
                r = await c.get(EONET_URL, params={"status": "open", "days": days, "limit": limit}, timeout=30)
                r.raise_for_status()
                data = r.json()
            f.write_text(json.dumps(data))
        except httpx.HTTPError as e:
            if not f.exists():
                raise HTTPException(502, f"NASA EONET request failed: {e}")
            data = json.loads(f.read_text())
    out = []
    for ev in data.get("events", []):
        geoms = [g for g in ev.get("geometry") or [] if g and g.get("coordinates")]
        if not geoms:
            continue
        g = max(geoms, key=lambda g: g["date"])
        coords = g["coordinates"]
        while isinstance(coords[0], list):
            coords = coords[0]
        lon, lat = coords[0], coords[1]
        day = str(g["date"])[:10]
        title = ev.get("title", "")
        planned = " RX " in f" {title.upper()} " or title.lower().startswith("prescribed")
        out.append({
            "id": ev["id"], "title": f"{title} (planned)" if planned else title,
            "category": (ev.get("categories") or [{}])[0].get("title", "Natural event"),
            "date": day, "lat": lat, "lon": lon,
            "magnitude": f"{g['magnitudeValue']} {g.get('magnitudeUnit') or ''}".strip() if g.get("magnitudeValue") is not None else None,
            "link": ev.get("link") or f"{EONET_URL}/{ev['id']}",
            "thumbUrl": snapshot_url([lat - 3, lon - 3, lat + 3, lon + 3], day, 480, 360),
            "planned": planned,
        })
    out.sort(key=lambda e: e["date"], reverse=True)
    return out


# Serve the plain HTML/CSS/JS frontend so one command runs the whole app.
app.mount("/", StaticFiles(directory=ROOT.parent / "frontend", html=True), name="frontend")
