// js/cases.js (P1) — case-study places. Contract §6.1.
// bbox = [latMin, lonMin, latMax, lonMax]; monthDay = date used every year (late-summer, mostly cloud-free).

export const CASES = [
  { id: "aral",  name: "Aral Sea",   country: "Kazakhstan / Uzbekistan",
    bbox: [43, 57.5, 47, 62.5],      monthDay: "08-20" },
  { id: "urmia", name: "Lake Urmia", country: "Iran",
    bbox: [37, 44.9, 38.5, 46.2],    monthDay: "08-20" },
  { id: "mead",  name: "Lake Mead",  country: "USA",
    bbox: [35.9, -115, 36.6, -114],  monthDay: "08-20" },
];

export function getCase(id) {
  return CASES.find((c) => c.id === id) || null;
}
