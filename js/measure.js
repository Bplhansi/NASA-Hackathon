// js/measure.js (P1) — count water pixels in NASA MODIS images.
//
// Two images of the same box and date, pixel-aligned:
//   • true colour (MODIS_Terra_CorrectedReflectance_TrueColor)  → shown to people, used for "no data"
//   • bands 7-2-1 (MODIS_Terra_CorrectedReflectance_Bands721)   → used to find water and clouds
//
// Why 7-2-1? In true colour, water can be blue, black, algae-green or even brine-red (Lake Urmia
// 2010–2013). In 7-2-1 the red channel is shortwave infrared (band 7) and the green channel is
// near infrared (band 2). Water absorbs both, so open water is always dark navy/black, whatever its
// visible colour. Thresholds were tuned by eye on real Worldview images: see assets/debug-mask.png.
//
//   water   = 7-2-1: SWIR (R) < 45 and NIR (G) < 70 and B ≥ R
//   cloud   = 7-2-1: bright in all three bands (R > 110, G > 190, B > 190)
//             (wet salt flats are cyan in 7-2-1 with low R, so they are NOT counted as cloud)
//   no data = true colour (near) pure black — MODIS swath gaps
//   haze    = even the darkest 0.3% of the scene is not dark in SWIR (> 25) → thin cloud/smoke over
//             everything, which hides water (e.g. Lake Mead 2026-08-20). Treated like a cloudy image.
//
// If only a true-colour image is passed, a fallback true-colour rule is used (less reliable).

const MAX_WIDTH = 400;
export const LIMITS = { maxCloudPct: 30, maxNoDataPct: 20, maxDarkSwir: 25 };

const LAND = 0, WATER = 1, CLOUD = 2, NODATA = 3;

/** Classify one pixel. tc = true-colour [r,g,b]; ir = 7-2-1 [r,g,b] or null. */
export function classifyPixel(tr, tg, tb, ir, ig, ib) {
  if (Math.max(tr, tg, tb) < 12) return NODATA;
  if (ir !== undefined) {
    if (ir > 110 && ig > 190 && ib > 190) return CLOUD;
    if (ir < 45 && ig < 70 && ib >= ir) return WATER;
    return LAND;
  }
  // fallback: true colour only
  const max = Math.max(tr, tg, tb), min = Math.min(tr, tg, tb), avg = (tr + tg + tb) / 3;
  if (avg > 200 && max - min < 30) return CLOUD;
  if (avg < 160 && ((tb > tr + 6) || (tg - tr >= 18 && tb >= tr - 12))) return WATER;
  return LAND;
}

function pixels(img, w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, ctx, imageData: ctx.getImageData(0, 0, w, h) }; // throws on CORS taint
}

function sizeFor(img) {
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  const scale = Math.min(1, MAX_WIDTH / w0);
  return [Math.max(1, Math.round(w0 * scale)), Math.max(1, Math.round(h0 * scale))];
}

function classifyAll(trueImg, irImg) {
  const [w, h] = sizeFor(trueImg);
  const tc = pixels(trueImg, w, h);
  const ir = irImg ? pixels(irImg, w, h).imageData.data : null;
  const t = tc.imageData.data;
  const classes = new Uint8Array(t.length / 4);
  const swirHist = new Uint32Array(256);
  if (ir) for (let i = 0; i < ir.length; i += 4) swirHist[ir[i]]++;
  for (let i = 0, p = 0; i < t.length; i += 4, p++) {
    classes[p] = ir
      ? classifyPixel(t[i], t[i + 1], t[i + 2], ir[i], ir[i + 1], ir[i + 2])
      : classifyPixel(t[i], t[i + 1], t[i + 2]);
  }
  return { classes, tc, darkSwir: ir ? percentile(swirHist, classes.length, 0.003) : null };
}

function percentile(hist, total, q) {
  const target = total * q;
  let seen = 0;
  for (let v = 0; v < hist.length; v++) {
    seen += hist[v];
    if (seen > target) return v;
  }
  return 255;
}

/**
 * Measure water. Returns { waterPct, cloudPct, noDataPct, hazy, valid }.
 * waterPct = water ÷ all pixels that have data (the whole box), so clouds don't inflate it.
 * Never throws: a CORS failure returns { waterPct: null, valid: false, corsBlocked: true }.
 */
export function measureWater(trueImg, irImg = null) {
  let classes, darkSwir;
  try {
    ({ classes, darkSwir } = classifyAll(trueImg, irImg));
  } catch (err) {
    return { waterPct: null, cloudPct: null, noDataPct: null, valid: false, corsBlocked: true };
  }

  let water = 0, cloud = 0, noData = 0;
  for (const k of classes) {
    if (k === WATER) water++;
    else if (k === CLOUD) cloud++;
    else if (k === NODATA) noData++;
  }
  const total = classes.length;
  const withData = total - noData;
  const round1 = (n) => Math.round(n * 10) / 10;
  const cloudPct = round1((cloud / total) * 100);
  const noDataPct = round1((noData / total) * 100);
  const hazy = darkSwir != null && darkSwir > LIMITS.maxDarkSwir;
  return {
    waterPct: withData > 0 ? round1((water / withData) * 100) : null,
    cloudPct,
    noDataPct,
    hazy,
    valid: withData > 0 && !hazy && cloudPct <= LIMITS.maxCloudPct && noDataPct <= LIMITS.maxNoDataPct,
  };
}

/** Debug helper: a canvas of the true-colour image with water painted cyan and clouds magenta. */
export function debugMask(trueImg, irImg = null) {
  const { classes, tc } = classifyAll(trueImg, irImg);
  const d = tc.imageData.data;
  for (let p = 0; p < classes.length; p++) {
    const i = p * 4;
    if (classes[p] === WATER) { d[i] = 0; d[i + 1] = 255; d[i + 2] = 255; }
    else if (classes[p] === CLOUD) { d[i] = 255; d[i + 1] = 0; d[i + 2] = 255; }
  }
  tc.ctx.putImageData(tc.imageData, 0, 0);
  return tc.canvas;
}
