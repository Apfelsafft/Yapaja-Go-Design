import { describe, it, expect } from 'vitest';
import { createRecorderState, startRecording, stopRecording, applyFix, GAP_THRESHOLD_MS } from './recorder.js';
import type { RecordedPoint } from './recorder.js';

function fix(overrides: Partial<RecordedPoint> = {}): RecordedPoint {
  return { lat: 47.4, lon: 9.6, ele: 500, ts: '2026-08-02T10:00:00.000Z', ...overrides };
}

function isoPlusMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

describe('createRecorderState', () => {
  it('starts idle with no segments', () => {
    const s = createRecorderState();
    expect(s.recording).toBe(false);
    expect(s.segments).toEqual([]);
    expect(s.pointCount).toBe(0);
  });
});

describe('startRecording / stopRecording', () => {
  it('start sets recording=true and resets counters', () => {
    const s = startRecording(createRecorderState(), 't-1', '2026-08-02T10:00:00.000Z');
    expect(s.recording).toBe(true);
    expect(s.trackId).toBe('t-1');
    expect(s.startedAt).toBe('2026-08-02T10:00:00.000Z');
    expect(s.segments).toEqual([]);
  });

  it('start is a no-op while already recording (does not reset progress)', () => {
    let s = startRecording(createRecorderState(), 't-1', '2026-08-02T10:00:00.000Z');
    s = applyFix(s, fix());
    const again = startRecording(s, 't-2', '2026-08-02T10:05:00.000Z');
    expect(again).toBe(s); // unchanged reference -- true no-op
  });

  it('stop sets recording=false but keeps the accumulated segments', () => {
    let s = startRecording(createRecorderState(), 't-1', '2026-08-02T10:00:00.000Z');
    s = applyFix(s, fix());
    const stopped = stopRecording(s);
    expect(stopped.recording).toBe(false);
    expect(stopped.segments).toEqual(s.segments);
  });

  it('stop is a no-op when not recording', () => {
    const s = createRecorderState();
    expect(stopRecording(s)).toBe(s);
  });
});

describe('applyFix', () => {
  it('is a no-op when not recording', () => {
    const s = createRecorderState();
    expect(applyFix(s, fix())).toBe(s);
  });

  it('starts the first segment on the first accepted fix', () => {
    let s = startRecording(createRecorderState(), 't-1', '2026-08-02T10:00:00.000Z');
    s = applyFix(s, fix({ ts: '2026-08-02T10:00:00.000Z' }));
    expect(s.segments).toHaveLength(1);
    expect(s.segments[0]).toHaveLength(1);
    expect(s.pointCount).toBe(1);
  });

  it('appends consecutive fixes to the SAME segment when the gap is small', () => {
    let s = startRecording(createRecorderState(), 't-1', '2026-08-02T10:00:00.000Z');
    const t0 = '2026-08-02T10:00:00.000Z';
    s = applyFix(s, fix({ ts: t0, lat: 47.4 }));
    s = applyFix(s, fix({ ts: isoPlusMs(t0, 1000), lat: 47.401 }));
    s = applyFix(s, fix({ ts: isoPlusMs(t0, 2000), lat: 47.402 }));
    expect(s.segments).toHaveLength(1);
    expect(s.segments[0]).toHaveLength(3);
    expect(s.pointCount).toBe(3);
  });

  it('THE CORE RULE: a gap exceeding the threshold starts a NEW <trkseg>, never bridged', () => {
    let s = startRecording(createRecorderState(), 't-1', '2026-08-02T10:00:00.000Z');
    const t0 = '2026-08-02T10:00:00.000Z';
    s = applyFix(s, fix({ ts: t0, lat: 47.4 }));
    s = applyFix(s, fix({ ts: isoPlusMs(t0, 1000), lat: 47.401 }));
    // a GPS outage: the next fix arrives well beyond GAP_THRESHOLD_MS later.
    const afterGap = isoPlusMs(t0, 1000 + GAP_THRESHOLD_MS + 1);
    s = applyFix(s, fix({ ts: afterGap, lat: 48.0 })); // far away, post-outage position
    s = applyFix(s, fix({ ts: isoPlusMs(afterGap, 1000), lat: 48.001 }));

    expect(s.segments).toHaveLength(2);
    expect(s.segments[0]).toHaveLength(2);
    expect(s.segments[1]).toHaveLength(2);
    expect(s.pointCount).toBe(4);
  });

  it('a gap of EXACTLY the threshold does not split (only strictly greater than)', () => {
    let s = startRecording(createRecorderState(), 't-1', '2026-08-02T10:00:00.000Z');
    const t0 = '2026-08-02T10:00:00.000Z';
    s = applyFix(s, fix({ ts: t0 }));
    s = applyFix(s, fix({ ts: isoPlusMs(t0, GAP_THRESHOLD_MS) }));
    expect(s.segments).toHaveLength(1);
    expect(s.segments[0]).toHaveLength(2);
  });

  it('supports multiple outages -> multiple new segments', () => {
    let s = startRecording(createRecorderState(), 't-1', '2026-08-02T10:00:00.000Z');
    let t = '2026-08-02T10:00:00.000Z';
    s = applyFix(s, fix({ ts: t }));
    for (let i = 0; i < 2; i++) {
      t = isoPlusMs(t, GAP_THRESHOLD_MS + 500);
      s = applyFix(s, fix({ ts: t }));
    }
    expect(s.segments).toHaveLength(3);
    expect(s.segments.every((seg) => seg.length === 1)).toBe(true);
  });

  it('a fix arriving after stop() (recording already false) is ignored', () => {
    let s = startRecording(createRecorderState(), 't-1', '2026-08-02T10:00:00.000Z');
    s = applyFix(s, fix());
    s = stopRecording(s);
    const after = applyFix(s, fix({ lat: 99 }));
    expect(after).toBe(s);
  });
});
