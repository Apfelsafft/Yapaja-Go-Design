/**
 * GPX 1.1 serialization for the Track-Recorder (E09-T5, docs/05 §6.2). Pure
 * string-building, no XML library dependency (GPX is a small, well-known
 * subset of XML and hand-building it keeps the add-on's bundle tiny).
 *
 * THE SEGMENT-SPLIT RULE, made concrete in the output format: every entry of
 * `segments` becomes its OWN `<trkseg>` inside a SINGLE `<trk>`. A GPX
 * consumer (and every mapping tool that understands the format) renders each
 * `<trkseg>` as a separate polyline -- so a GPS-loss gap between two
 * segments is a genuine break in the drawn line, never a straight line
 * jumping across the outage.
 */

import type { RecordedPoint } from './recorder.js';

const GPX_NAMESPACE = 'http://www.topografix.com/GPX/1/1';
const CREATOR = 'Yapaja Go Track-Recorder (E09-T5 reference add-on)';

/** Minimal XML text-escaping for the handful of characters GPX's
 *  attribute/element text content needs escaped. Not a general XML
 *  serializer -- deliberately scoped to what track/point names can contain. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Fixed-precision decimal formatting for lat/lon/ele -- avoids `toString()`
 *  ever emitting exponential notation (e.g. `1e-7`) for very small
 *  magnitudes, which is valid IEEE754-to-string but NOT valid GPX/XSD
 *  `decimal` syntax. */
function formatDecimal(value: number, digits: number): string {
  return value.toFixed(digits);
}

export interface BuildGpxOptions {
  trackName: string;
  segments: readonly RecordedPoint[][];
}

/** Serializes one recorded track (its segments) into a complete GPX 1.1
 *  document string. Segments with zero points are skipped (never emits an
 *  empty `<trkseg></trkseg>` -- not invalid GPX, just noise no consumer
 *  needs, and it would falsely inflate "how many outages happened"). */
export function buildGpx(opts: BuildGpxOptions): string {
  const segmentsXml = opts.segments
    .filter((seg) => seg.length > 0)
    .map((seg) => {
      const points = seg
        .map((p) => {
          const eleXml = p.ele !== null && Number.isFinite(p.ele) ? `<ele>${formatDecimal(p.ele, 1)}</ele>` : '';
          return `<trkpt lat="${formatDecimal(p.lat, 6)}" lon="${formatDecimal(p.lon, 6)}">${eleXml}<time>${escapeXml(p.ts)}</time></trkpt>`;
        })
        .join('');
      return `<trkseg>${points}</trkseg>`;
    })
    .join('');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<gpx version="1.1" creator="${escapeXml(CREATOR)}" xmlns="${GPX_NAMESPACE}">` +
    `<trk><name>${escapeXml(opts.trackName)}</name>${segmentsXml}</trk>` +
    `</gpx>`
  );
}
