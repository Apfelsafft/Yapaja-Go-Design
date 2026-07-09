import { describe, it, expect } from 'vitest';
import { parseRange } from './range.js';

const SIZE = 20000;

describe('parseRange', () => {
  it('returns "none" when no Range header is present', () => {
    expect(parseRange(undefined, SIZE)).toEqual({ kind: 'none' });
  });

  it('parses a range from the start (0-N)', () => {
    expect(parseRange('bytes=0-16383', SIZE)).toEqual({
      kind: 'satisfiable',
      start: 0,
      end: 16383,
    });
  });

  it('parses a range in the middle of the file', () => {
    expect(parseRange('bytes=5000-9999', SIZE)).toEqual({
      kind: 'satisfiable',
      start: 5000,
      end: 9999,
    });
  });

  it('parses a suffix range (-N, last N bytes)', () => {
    expect(parseRange('bytes=-500', SIZE)).toEqual({
      kind: 'satisfiable',
      start: SIZE - 500,
      end: SIZE - 1,
    });
  });

  it('clamps an oversized suffix range to the whole file', () => {
    expect(parseRange(`bytes=-${SIZE + 1000}`, SIZE)).toEqual({
      kind: 'satisfiable',
      start: 0,
      end: SIZE - 1,
    });
  });

  it('parses an open-ended range (N-)', () => {
    expect(parseRange('bytes=1000-', SIZE)).toEqual({
      kind: 'satisfiable',
      start: 1000,
      end: SIZE - 1,
    });
  });

  it('clamps an end beyond the file size to the last byte', () => {
    expect(parseRange(`bytes=0-${SIZE + 5000}`, SIZE)).toEqual({
      kind: 'satisfiable',
      start: 0,
      end: SIZE - 1,
    });
  });

  it('rejects a start beyond the end of the file as unsatisfiable', () => {
    expect(parseRange(`bytes=${SIZE}-${SIZE + 100}`, SIZE)).toEqual({ kind: 'unsatisfiable' });
  });

  it('rejects end < start as unsatisfiable', () => {
    expect(parseRange('bytes=5000-1000', SIZE)).toEqual({ kind: 'unsatisfiable' });
  });

  it('rejects a zero-length suffix range as unsatisfiable', () => {
    expect(parseRange('bytes=-0', SIZE)).toEqual({ kind: 'unsatisfiable' });
  });

  it('rejects garbage range syntax as unsatisfiable', () => {
    expect(parseRange('bytes=abc-def', SIZE)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRange('bytes=-', SIZE)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRange('bytes=', SIZE)).toEqual({ kind: 'unsatisfiable' });
  });

  it('ignores an unsupported range unit and serves the full body', () => {
    expect(parseRange('items=0-1', SIZE)).toEqual({ kind: 'full' });
  });

  it('ignores multi-range requests (unsupported) and serves the full body', () => {
    expect(parseRange('bytes=0-100,200-300', SIZE)).toEqual({ kind: 'full' });
  });

  it('treats a zero-byte resource as unsatisfiable for any range', () => {
    expect(parseRange('bytes=0-10', 0)).toEqual({ kind: 'unsatisfiable' });
  });
});
