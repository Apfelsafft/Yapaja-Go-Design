/**
 * Coordinate-string parser (E05-T1, step 1 of the `GeocoderBackend` chain).
 * No network involved -- runs synchronously against the raw query string and
 * short-circuits the rest of the chain when it recognizes direct
 * coordinates.
 *
 * Supported formats:
 *  - Decimal:  "47.14, 9.52" / "47.14 9.52" / "47.14,9.52" (lat, lon order)
 *  - DMS:      `47°08'24"N 9°31'12"E`, with or without seconds; the N/S/E/W
 *              hemisphere letters disambiguate lat vs. lon, so component
 *              order doesn't matter for DMS.
 *
 * Swap detection (decimal only): if the first number can't be a latitude
 * (|value| > 90) but *can* be a longitude, and the second number is a valid
 * latitude, we assume the user swapped lat/lon and return the swapped
 * coordinate with a note in `label`. If swapping still doesn't produce a
 * valid pair, no coords result is returned (falls through to Photon).
 */

import type { SearchResult } from '@yapaja/shared';

const SWAP_NOTE = 'Koordinaten evtl. vertauscht?';

function isValidLat(n: number): boolean {
  return Number.isFinite(n) && n >= -90 && n <= 90;
}

function isValidLon(n: number): boolean {
  return Number.isFinite(n) && n >= -180 && n <= 180;
}

/** Normalizes typographic quote variants to plain `'`/`"` so DMS input like
 *  `47°08’24”N` (curly quotes, common on mobile keyboards) still parses. */
function normalize(raw: string): string {
  return raw
    .trim()
    .replace(/[‘’ʼ´`]/g, "'")
    .replace(/[“”ʺ]/g, '"');
}

function buildResult(lat: number, lon: number, swapped: boolean): SearchResult {
  const label = swapped
    ? `${lat.toFixed(5)}, ${lon.toFixed(5)} (${SWAP_NOTE})`
    : `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  return {
    name: 'Koordinaten',
    label,
    latlng: { lat, lon },
    type: 'coordinates',
    source: 'coords',
  };
}

const DECIMAL_PATTERN = /^(-?\d+(?:\.\d+)?)(?:\s*,\s*|\s+)(-?\d+(?:\.\d+)?)$/;

function parseDecimal(normalized: string): { lat: number; lon: number; swapped: boolean } | null {
  const match = normalized.match(DECIMAL_PATTERN);
  if (!match) return null;

  const n1 = Number(match[1]);
  const n2 = Number(match[2]);

  if (isValidLat(n1) && isValidLon(n2)) {
    return { lat: n1, lon: n2, swapped: false };
  }
  // Swap detection: n1 can only be a longitude, n2 can only be interpreted as
  // the (missing) latitude -- and it fits.
  if (!isValidLat(n1) && isValidLon(n1) && isValidLat(n2)) {
    return { lat: n2, lon: n1, swapped: true };
  }
  return null;
}

// One DMS component, e.g. `47°08'24"N` or `9°31'E` (seconds optional).
const DMS_COMPONENT_PATTERN =
  /(\d{1,3})\s*°\s*(\d{1,2})\s*'\s*(?:(\d{1,2}(?:\.\d+)?)\s*"\s*)?([NSEWnsew])/g;

function parseDms(normalized: string): { lat: number; lon: number } | null {
  const matches = [...normalized.matchAll(DMS_COMPONENT_PATTERN)];
  if (matches.length !== 2) return null;

  // Reject if there's leftover, unrecognized text around the two components
  // (guards against false-positive matches inside garbage input).
  let remainder = normalized;
  for (const m of matches) {
    remainder = remainder.replace(m[0], '');
  }
  if (remainder.replace(/[\s,]/g, '').length > 0) return null;

  const components = matches.map((m) => {
    const deg = Number(m[1]);
    const min = Number(m[2]);
    const sec = m[3] !== undefined ? Number(m[3]) : 0;
    const hemisphere = m[4].toUpperCase();
    const magnitude = deg + min / 60 + sec / 3600;
    const axis: 'lat' | 'lon' = hemisphere === 'N' || hemisphere === 'S' ? 'lat' : 'lon';
    const sign = hemisphere === 'S' || hemisphere === 'W' ? -1 : 1;
    return { axis, value: sign * magnitude };
  });

  const latComponent = components.find((c) => c.axis === 'lat');
  const lonComponent = components.find((c) => c.axis === 'lon');
  // Both components must cover distinct axes (e.g. one N/S, one E/W).
  if (!latComponent || !lonComponent) return null;
  if (!isValidLat(latComponent.value) || !isValidLon(lonComponent.value)) return null;

  return { lat: latComponent.value, lon: lonComponent.value };
}

/**
 * Parses a raw search query string as coordinates. Returns `null` (never
 * throws) if the string isn't recognizable as coordinates in any supported
 * format -- callers should fall through to the next backend in that case.
 */
export function parseCoordinates(raw: string): SearchResult | null {
  if (typeof raw !== 'string') return null;
  const normalized = normalize(raw);
  if (normalized.length === 0) return null;

  const dms = parseDms(normalized);
  if (dms) return buildResult(dms.lat, dms.lon, false);

  const decimal = parseDecimal(normalized);
  if (decimal) return buildResult(decimal.lat, decimal.lon, decimal.swapped);

  return null;
}
