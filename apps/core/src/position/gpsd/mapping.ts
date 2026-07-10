/**
 * Pure mapping from gpsd JSON protocol objects (TPV/SKY classes) to the
 * shared `Position` type. Kept free of any `net`/socket concerns so it's
 * directly unit-testable against fixtures (docs reference: gpsd JSON
 * protocol, `?WATCH={"enable":true,"json":true}`, classes TPV/SKY/VERSION/
 * DEVICES/WATCH).
 */

import type { Position } from '@yapaja/shared';

/** Shape of a gpsd `TPV` (Time-Position-Velocity) report. All fields are
 * optional/untrusted -- gpsd omits fields it has no data for, and older
 * daemon versions or unusual device states can omit more than usual. */
export interface GpsdTpv {
  [key: string]: unknown;
  class?: unknown;
  mode?: unknown;
  lat?: unknown;
  lon?: unknown;
  alt?: unknown;
  altMSL?: unknown;
  speed?: unknown;
  track?: unknown;
  eph?: unknown;
  epx?: unknown;
  epy?: unknown;
  time?: unknown;
}

/** Shape of a gpsd `SKY` report -- only the field this source uses. */
export interface GpsdSky {
  [key: string]: unknown;
  class?: unknown;
  satellites?: unknown;
}

export function isGpsdTpv(msg: Record<string, unknown>): msg is GpsdTpv {
  return msg.class === 'TPV';
}

export function isGpsdSky(msg: Record<string, unknown>): msg is GpsdSky {
  return msg.class === 'SKY';
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** accuracy := eph, or max(epx, epy) when eph is absent (task spec's gpsd protocol note). */
function computeAccuracy(tpv: GpsdTpv): number | null {
  const eph = numOrNull(tpv.eph);
  if (eph !== null) return eph;

  const epx = numOrNull(tpv.epx);
  const epy = numOrNull(tpv.epy);
  if (epx !== null && epy !== null) return Math.max(epx, epy);
  if (epx !== null) return epx;
  if (epy !== null) return epy;
  return null;
}

/** mode 0/1 -> no fix (must never become a Position); 2 -> '2d'; >=3 -> '3d'. */
function mapFixMode(mode: unknown): '2d' | '3d' | null {
  if (typeof mode !== 'number') return null;
  if (mode >= 3) return '3d';
  if (mode === 2) return '2d';
  return null;
}

/**
 * Maps a gpsd TPV report to a `Position`, or `null` when the report carries
 * no usable fix (mode 0/1, missing/invalid mode, or missing/invalid
 * lat/lon -- coordinates are the one thing that can never be defaulted).
 * `fallbackTs` (ISO 8601) is used only when `tpv.time` is missing or
 * unparseable; passed in rather than read from `Date.now()` so this stays a
 * pure, deterministically testable function.
 */
export function mapTpvToPosition(tpv: GpsdTpv, fallbackTs: string): Position | null {
  const fix = mapFixMode(tpv.mode);
  if (fix === null) return null;

  const lat = numOrNull(tpv.lat);
  const lon = numOrNull(tpv.lon);
  if (lat === null || lon === null) return null;

  const alt = numOrNull(tpv.altMSL) ?? numOrNull(tpv.alt);
  const speed = numOrNull(tpv.speed);
  const heading = numOrNull(tpv.track);
  const accuracy = computeAccuracy(tpv);

  const ts =
    typeof tpv.time === 'string' && !Number.isNaN(Date.parse(tpv.time))
      ? new Date(tpv.time).toISOString()
      : fallbackTs;

  return { lat, lon, alt, speed, heading, accuracy, source: 'gpsd', fix, ts };
}

/** Satellite count from a SKY report's `satellites` array, or `null` if absent/malformed. */
export function extractSatelliteCount(sky: GpsdSky): number | null {
  return Array.isArray(sky.satellites) ? sky.satellites.length : null;
}
