/**
 * Minimal GPX track-point parser (E02-T4).
 *
 * Design choice (per task instructions, "wähle den saubereren Weg und
 * begründe kurz"): we hand-roll a small, purpose-built parser instead of
 * adding `fast-xml-parser` as a dependency. Reasoning:
 *  - The only GPX subset we need is `<trkpt lat lon>` with optional
 *    `<ele>`/`<time>` children (docs/07-testing-qa.md §2) -- a full
 *    general-purpose XML parser (namespaces, CDATA, entities, DTDs, mixed
 *    content) is solving a much bigger problem than we have.
 *  - All three shipped fixtures are hand-authored by us (see
 *    __fixtures__/*.gpx); "inline GPX" via the play API is a dev/test
 *    convenience, not a channel for untrusted third-party uploads, so we
 *    don't need general-XML robustness for security reasons either.
 *  - One fewer runtime dependency to bundle/audit for a backend service
 *    that ships as a single Node binary (tsup bundles @yapaja/shared and
 *    friends into apps/core/dist -- see apps/core/tsup.config.ts).
 * Trade-off: this parser is intentionally narrow. It does not handle GPX
 * extensions, multiple `<trk>`/`<trkseg>` elements (it flattens all trkpt
 * across the whole document, in document order), or malformed/truncated
 * XML gracefully beyond throwing a clear error.
 */

export interface GpxTrackPoint {
  lat: number;
  lon: number;
  /** Elevation in meters, or null if the point has no <ele>. */
  ele: number | null;
  /** ISO 8601 timestamp, or null if the point has no <time>. */
  time: string | null;
}

export class GpxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GpxParseError';
  }
}

// Matches one <trkpt ...>...</trkpt> or self-closing <trkpt .../>, capturing
// the attribute string and (for the non-self-closing form) the inner content.
const TRKPT_RE = /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/g;

function extractAttr(attrs: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
  if (match) return match[1];
  const singleQuoted = new RegExp(`${name}\\s*=\\s*'([^']*)'`).exec(attrs);
  return singleQuoted ? singleQuoted[1] : null;
}

function extractChildText(content: string, tag: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*>([^<]*)<\\/${tag}>`).exec(content);
  return match ? match[1].trim() : null;
}

/** Parse a GPX document's track points, in document order. Throws GpxParseError on structural problems. */
export function parseGpxTrackPoints(gpxXml: string): GpxTrackPoint[] {
  if (typeof gpxXml !== 'string' || gpxXml.trim().length === 0) {
    throw new GpxParseError('GPX input is empty');
  }

  const points: GpxTrackPoint[] = [];
  let match: RegExpExecArray | null;
  TRKPT_RE.lastIndex = 0;
  while ((match = TRKPT_RE.exec(gpxXml)) !== null) {
    const [, attrs, content = ''] = match;
    const latStr = extractAttr(attrs, 'lat');
    const lonStr = extractAttr(attrs, 'lon');
    if (latStr === null || lonStr === null) {
      throw new GpxParseError('<trkpt> is missing lat or lon attribute');
    }
    const lat = Number(latStr);
    const lon = Number(lonStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new GpxParseError(`<trkpt> has non-numeric lat/lon: "${latStr}", "${lonStr}"`);
    }

    const eleStr = extractChildText(content, 'ele');
    const ele = eleStr !== null && eleStr !== '' ? Number(eleStr) : null;
    const time = extractChildText(content, 'time');

    points.push({
      lat,
      lon,
      ele: ele !== null && Number.isFinite(ele) ? ele : null,
      time: time && time.length > 0 ? time : null,
    });
  }

  if (points.length < 2) {
    throw new GpxParseError('GPX must contain at least 2 <trkpt> points to build a track');
  }

  return points;
}
