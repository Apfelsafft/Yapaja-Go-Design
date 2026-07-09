/**
 * HTTP Range header parsing (RFC 7233) for a single resource of known size.
 * Only the `bytes` unit and single-range requests are supported, which is
 * sufficient for PMTiles clients (they issue one byte range per request).
 */

export type RangeResult =
  | { kind: 'none' } // no Range header present -> serve full resource (200)
  | { kind: 'full' } // Range header present but unsupported (multi-range /
  //   unknown unit) -> per RFC 7233 servers MAY ignore it -> serve full (200)
  | { kind: 'satisfiable'; start: number; end: number } // -> 206, inclusive bounds
  | { kind: 'unsatisfiable' }; // -> 416

const BYTES_UNIT_RE = /^bytes=(.*)$/;
const SINGLE_RANGE_RE = /^(\d*)-(\d*)$/;

/**
 * Parse a `Range` header value against a resource of `size` bytes.
 */
export function parseRange(rangeHeader: string | undefined, size: number): RangeResult {
  if (!rangeHeader) {
    return { kind: 'none' };
  }

  const unitMatch = BYTES_UNIT_RE.exec(rangeHeader.trim());
  if (!unitMatch) {
    // Unsupported unit (e.g. "items=0-1") -> ignore, serve full body.
    return { kind: 'full' };
  }

  const spec = unitMatch[1] ?? '';
  if (spec.includes(',')) {
    // Multiple ranges requested; we don't support multipart/byteranges.
    // RFC 7233 permits ignoring the header and returning the full body.
    return { kind: 'full' };
  }

  if (size === 0) {
    return { kind: 'unsatisfiable' };
  }

  const rangeMatch = SINGLE_RANGE_RE.exec(spec.trim());
  if (!rangeMatch) {
    return { kind: 'unsatisfiable' };
  }

  const startStr = rangeMatch[1] ?? '';
  const endStr = rangeMatch[2] ?? '';

  if (startStr === '' && endStr === '') {
    // "bytes=-" is malformed.
    return { kind: 'unsatisfiable' };
  }

  if (startStr === '') {
    // Suffix range: "bytes=-N" -> last N bytes.
    const suffixLength = Number.parseInt(endStr, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return { kind: 'unsatisfiable' };
    }
    const start = Math.max(0, size - suffixLength);
    return { kind: 'satisfiable', start, end: size - 1 };
  }

  const start = Number.parseInt(startStr, 10);
  if (!Number.isFinite(start) || start >= size) {
    return { kind: 'unsatisfiable' };
  }

  if (endStr === '') {
    // Open-ended range: "bytes=N-" -> from N to end of file.
    return { kind: 'satisfiable', start, end: size - 1 };
  }

  const end = Number.parseInt(endStr, 10);
  if (!Number.isFinite(end) || end < start) {
    return { kind: 'unsatisfiable' };
  }

  return { kind: 'satisfiable', start, end: Math.min(end, size - 1) };
}
