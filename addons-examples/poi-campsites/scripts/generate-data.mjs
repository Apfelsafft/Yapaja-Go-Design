#!/usr/bin/env node
/**
 * One-off generator for `data/campsites.geojson` (~200 plausible campsite
 * POIs around the Lake Constance / Allgäu area used by the rest of this
 * repo's fixtures, e.g. `FIXTURE_REGION` bounds in
 * `apps/web/e2e/support/constants.ts`). NOT part of the add-on's runtime or
 * build -- run by hand (`node scripts/generate-data.mjs`) whenever the
 * fixture data needs regenerating; the output is checked into git so the
 * add-on itself never depends on this script.
 *
 * Deterministic (seeded PRNG) so re-running produces byte-identical output.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, '..', 'data', 'campsites.geojson');

// mulberry32 -- same tiny deterministic PRNG algorithm the Core's own GPS
// simulator uses (apps/core/src/position/simulator/rng.ts), reimplemented
// here rather than imported: this script is a standalone dev tool outside
// the add-on's own dependency graph.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20260802);

const CATEGORIES = [
  { id: 'stellplatz', label: 'Stellplatz', weight: 5 },
  { id: 'campingplatz', label: 'Campingplatz', weight: 3 },
  { id: 'wildcamping', label: 'Wildcamping-Spot', weight: 2 },
  { id: 'raststaette', label: 'Raststätte mit Stellplatz', weight: 1 },
];

const NAME_PARTS_A = [
  'Seeblick', 'Waldrand', 'Sonnenhof', 'Alpenpanorama', 'Rebenhof', 'Uferwiese',
  'Kastanienhof', 'Bergblick', 'Talgrund', 'Auwiese', 'Lindenhof', 'Birkenweg',
  'Mühlenwiese', 'Obstgarten', 'Fischerhafen', 'Klosterwiese', 'Rosengarten',
  'Feldrain', 'Bachufer', 'Sternenhimmel',
];
const NAME_PARTS_B = [
  'am See', 'im Grünen', 'an der Grenze', 'im Tal', 'am Fluss', 'am Wald',
  'bei den Reben', 'an der Alten Landstraße', 'am Ortsrand', 'im Naturpark',
];

const AMENITIES_POOL = [
  'Frischwasser', 'Entsorgung', 'Strom', 'WLAN', 'Sanitäranlagen', 'Hund erlaubt',
  'Kinderspielplatz', 'Einkauf in Gehweite', 'Seezugang', 'Wanderwege',
];

function pick(arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function pickWeightedCategory() {
  const total = CATEGORIES.reduce((s, c) => s + c.weight, 0);
  let r = rng() * total;
  for (const c of CATEGORIES) {
    if (r < c.weight) return c;
    r -= c.weight;
  }
  return CATEGORIES[0];
}

function pickAmenities() {
  const count = 2 + Math.floor(rng() * 4);
  const pool = [...AMENITIES_POOL];
  const chosen = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    chosen.push(pool.splice(idx, 1)[0]);
  }
  return chosen;
}

// Bounding box roughly covering the Lake Constance / Allgäu region already
// used by this repo's other map fixtures.
const LAT_MIN = 47.15;
const LAT_MAX = 47.75;
const LON_MIN = 9.0;
const LON_MAX = 9.95;

const COUNT = 200;
const features = [];
for (let i = 0; i < COUNT; i++) {
  const lat = LAT_MIN + rng() * (LAT_MAX - LAT_MIN);
  const lon = LON_MIN + rng() * (LON_MAX - LON_MIN);
  const category = pickWeightedCategory();
  const name = `${pick(NAME_PARTS_A)} ${pick(NAME_PARTS_B)}`;
  const priceEur = category.id === 'wildcamping' ? 0 : Math.round((8 + rng() * 22) * 10) / 10;
  features.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] },
    properties: {
      id: `poi-${String(i + 1).padStart(3, '0')}`,
      name,
      category: category.id,
      categoryLabel: category.label,
      pricePerNightEur: priceEur,
      amenities: pickAmenities(),
      // A short, plausible German description -- purely fixture flavor text.
      description: `${category.label} „${name}“ mit ${pickAmenities().length} Ausstattungsmerkmalen.`,
    },
  });
}

const collection = { type: 'FeatureCollection', features };
writeFileSync(OUT_FILE, JSON.stringify(collection, null, 2) + '\n', 'utf-8');
console.log(`Wrote ${features.length} POIs to ${OUT_FILE}`);
