import { describe, it, expect } from 'vitest';
import { buildGpx } from './gpx.js';
import type { RecordedPoint } from './recorder.js';

function pt(overrides: Partial<RecordedPoint> = {}): RecordedPoint {
  return { lat: 47.4, lon: 9.6, ele: 500, ts: '2026-08-02T10:00:00.000Z', ...overrides };
}

describe('buildGpx', () => {
  it('emits the GPX 1.1 root element with the correct namespace', () => {
    const xml = buildGpx({ trackName: 'Testfahrt', segments: [[pt()]] });
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<gpx version="1.1"');
    expect(xml).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
  });

  it('emits exactly one <trkseg> per non-empty segment', () => {
    const segments = [
      [pt({ lat: 47.0 }), pt({ lat: 47.001 })],
      [pt({ lat: 48.0 }), pt({ lat: 48.001 }), pt({ lat: 48.002 })],
    ];
    const xml = buildGpx({ trackName: 'Testfahrt', segments });
    expect(countOccurrences(xml, '<trkseg>')).toBe(2);
    expect(countOccurrences(xml, '</trkseg>')).toBe(2);
    expect(countOccurrences(xml, '<trkpt')).toBe(5);
  });

  it('skips empty segments -- never emits <trkseg></trkseg>', () => {
    const xml = buildGpx({ trackName: 'Testfahrt', segments: [[pt()], [], [pt(), pt()]] });
    expect(countOccurrences(xml, '<trkseg>')).toBe(2);
    expect(xml).not.toContain('<trkseg></trkseg>');
  });

  it('emits exactly ONE <trk> even with multiple segments (one track, many segments)', () => {
    const xml = buildGpx({ trackName: 'Testfahrt', segments: [[pt()], [pt()], [pt()]] });
    expect(countOccurrences(xml, '<trk>')).toBe(1);
    expect(countOccurrences(xml, '</trk>')).toBe(1);
  });

  it('writes lat/lon as plain decimals, never exponential notation', () => {
    const xml = buildGpx({ trackName: 'x', segments: [[pt({ lat: 0.0000001, lon: -0.0000002 })]] });
    expect(xml).not.toMatch(/e[+-]/i);
    expect(xml).toContain('lat="0.000000"');
  });

  it('includes <ele> when present, and omits it when null', () => {
    const withEle = buildGpx({ trackName: 'x', segments: [[pt({ ele: 512.3 })]] });
    expect(withEle).toContain('<ele>512.3</ele>');

    const withoutEle = buildGpx({ trackName: 'x', segments: [[pt({ ele: null })]] });
    expect(withoutEle).not.toContain('<ele>');
  });

  it('includes <time> with the fix\'s ISO timestamp verbatim', () => {
    const xml = buildGpx({ trackName: 'x', segments: [[pt({ ts: '2026-08-02T10:15:30.500Z' })]] });
    expect(xml).toContain('<time>2026-08-02T10:15:30.500Z</time>');
  });

  it('XML-escapes a track name containing special characters', () => {
    const xml = buildGpx({ trackName: `Tour <"Rhein" & Bodensee>`, segments: [[pt()]] });
    expect(xml).toContain('<name>Tour &lt;&quot;Rhein&quot; &amp; Bodensee&gt;</name>');
    expect(xml).not.toContain('<name>Tour <"Rhein"');
  });

  it('produces a document with balanced tags for every element it emits', () => {
    const xml = buildGpx({
      trackName: 'Balance-Check',
      segments: [
        [pt(), pt(), pt()],
        [pt(), pt()],
      ],
    });
    for (const tag of ['gpx', 'trk', 'trkseg', 'trkpt', 'name', 'time']) {
      // Tag-boundary-aware: `<trk>` must not also match `<trkseg>`/`<trkpt>`.
      const openTag = new RegExp(`<${tag}(?:[ >])`, 'g');
      const closeTag = new RegExp(`</${tag}>`, 'g');
      const opens = (xml.match(openTag) ?? []).length;
      const closes = (xml.match(closeTag) ?? []).length;
      expect(closes, `unbalanced <${tag}>`).toBe(opens);
    }
  });

  it('handles zero segments (an empty recording) without throwing', () => {
    const xml = buildGpx({ trackName: 'Leer', segments: [] });
    expect(xml).toContain('<trk><name>Leer</name></trk>');
  });
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
