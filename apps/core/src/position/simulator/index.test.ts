/**
 * Integration tests for SimulatorSource against a real PositionService
 * (E02-T1): fixture-driven replay, all four mutations, speed_factor
 * determinism, and timer-leak checks around play/pause/resume/stop.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { checkPosition, validatePosition, type Position } from '@yapaja/shared';
import { EventBus } from '../../bus/index.js';
import { PositionService } from '../service.js';
import { SimulatorSource } from './index.js';
import { parseGpxTrackPoints } from './gpx.js';
import { buildTrackFromGpx, sampleTrack } from './track.js';
import { haversineDistanceM } from './geo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '__fixtures__');

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

const cityGpxPoints = parseGpxTrackPoints(readFixture('city.gpx'));
const cityTrack = buildTrackFromGpx(cityGpxPoints);

function setup(): { bus: EventBus; service: PositionService; simulator: SimulatorSource } {
  const bus = new EventBus({ isProduction: false });
  const service = new PositionService({ bus, checkIntervalMs: 100, rateHz: 1 });
  const simulator = new SimulatorSource(service);
  service.registerSource(simulator);
  return { bus, service, simulator };
}

describe('SimulatorSource + PositionService integration', () => {
  let bus: EventBus;
  let service: PositionService;
  let simulator: SimulatorSource;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ bus, service, simulator } = setup());
  });

  afterEach(() => {
    simulator.dispose();
    service.dispose();
    vi.useRealTimers();
  });

  it('emits schema-valid pos/update fixes with source "simulator" that pass checkPosition', () => {
    const received: Position[] = [];
    bus.subscribe('pos/update', (payload) => received.push(payload));

    simulator.play({ track: { gpxId: 'city' } });
    vi.advanceTimersByTime(5000); // 5 ticks at speed_factor=1 (1000ms/tick)

    expect(received.length).toBe(5);
    for (const pos of received) {
      expect(validatePosition(pos)).toBe(true);
      expect(checkPosition(pos).ok).toBe(true);
      expect(pos.fix).not.toBe('none');
      expect(pos.source).toBe('simulator');
    }
  });

  it('stops emitting fixes after stop(), even as fake time keeps advancing', () => {
    const pushSpy = vi.spyOn(service, 'pushFix');
    simulator.play({ track: { gpxId: 'city' } });
    vi.advanceTimersByTime(2000);
    const countBeforeStop = pushSpy.mock.calls.length;
    expect(countBeforeStop).toBeGreaterThan(0);

    simulator.stop();
    vi.advanceTimersByTime(10000);
    expect(pushSpy.mock.calls.length).toBe(countBeforeStop);
  });

  it('leaves no pending timer after stop() (no leak)', () => {
    const baseline = vi.getTimerCount(); // PositionService's own checkTimer
    simulator.play({ track: { gpxId: 'city' } });
    expect(vi.getTimerCount()).toBe(baseline + 1);

    simulator.stop();
    expect(vi.getTimerCount()).toBe(baseline);
  });

  it('leaves no pending timer while paused, and resumes from the same tick position', () => {
    const baseline = vi.getTimerCount();
    const pushSpy = vi.spyOn(service, 'pushFix');

    simulator.play({ track: { gpxId: 'city' } });
    vi.advanceTimersByTime(3000); // ticks t=0,1,2 pushed
    expect(pushSpy.mock.calls.length).toBe(3);

    simulator.pause();
    expect(vi.getTimerCount()).toBe(baseline);

    vi.advanceTimersByTime(10000); // nothing should happen while paused
    expect(pushSpy.mock.calls.length).toBe(3);

    simulator.resume();
    vi.advanceTimersByTime(1000); // tick t=3
    expect(pushSpy.mock.calls.length).toBe(4);

    const fourthFix = pushSpy.mock.calls[3][1] as Position;
    const expected = sampleTrack(cityTrack, 3);
    expect(fourthFix.lat).toBeCloseTo(expected!.lat, 5);
    expect(fourthFix.lon).toBeCloseTo(expected!.lon, 5);

    simulator.stop();
  });

  it('dispose() clears any pending timer', () => {
    const baseline = vi.getTimerCount();
    simulator.play({ track: { gpxId: 'city' } });
    expect(vi.getTimerCount()).toBe(baseline + 1);
    simulator.dispose();
    expect(vi.getTimerCount()).toBe(baseline);
  });
});

describe('speed_factor determinism', () => {
  it('produces the identical simulated-time fix sequence regardless of speed_factor (only wall-clock cadence differs)', () => {
    const ticks = 6;
    const mutations = { noise_m: 4, seed: 3 };

    vi.useFakeTimers();
    const runA = setup();
    const spyA = vi.spyOn(runA.service, 'pushFix');
    runA.simulator.play({ track: { gpxId: 'city' }, speed_factor: 1, mutations });
    vi.advanceTimersByTime(ticks * 1000);
    const seqA = spyA.mock.calls.map(([, pos]) => ({
      lat: pos.lat,
      lon: pos.lon,
      speed: pos.speed,
      heading: pos.heading,
    }));
    runA.simulator.dispose();
    runA.service.dispose();
    vi.useRealTimers();

    vi.useFakeTimers();
    const runB = setup();
    const spyB = vi.spyOn(runB.service, 'pushFix');
    runB.simulator.play({ track: { gpxId: 'city' }, speed_factor: 10, mutations });
    vi.advanceTimersByTime(ticks * 100); // 10x faster wall clock
    const seqB = spyB.mock.calls.map(([, pos]) => ({
      lat: pos.lat,
      lon: pos.lon,
      speed: pos.speed,
      heading: pos.heading,
    }));
    runB.simulator.dispose();
    runB.service.dispose();
    vi.useRealTimers();

    expect(seqA.length).toBe(ticks);
    expect(seqB).toEqual(seqA);
  });
});

describe('mutations - effectiveness', () => {
  let service: PositionService;
  let simulator: SimulatorSource;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ service, simulator } = setup());
  });

  afterEach(() => {
    simulator.dispose();
    service.dispose();
    vi.useRealTimers();
  });

  it('noise_m measurably (and deterministically) shifts fixes off the clean track', () => {
    const pushSpy = vi.spyOn(service, 'pushFix');
    simulator.play({ track: { gpxId: 'city' }, mutations: { noise_m: 20, seed: 42 } });
    vi.advanceTimersByTime(4000);

    const shifted = pushSpy.mock.calls.map(([, pos]) => pos as Position);
    let anyShifted = false;
    for (let t = 0; t < shifted.length; t++) {
      const clean = sampleTrack(cityTrack, t)!;
      const d = haversineDistanceM(shifted[t], clean);
      if (d > 0.01) anyShifted = true;
    }
    expect(anyShifted).toBe(true);
  });

  it('noise_m is reproducible for a fixed seed', () => {
    const spy1 = vi.spyOn(service, 'pushFix');
    simulator.play({ track: { gpxId: 'city' }, mutations: { noise_m: 20, seed: 42 } });
    vi.advanceTimersByTime(3000);
    const seq1 = spy1.mock.calls.map(([, pos]) => ({ lat: pos.lat, lon: pos.lon }));
    simulator.stop();

    const run2 = setup();
    vi.useFakeTimers(); // re-arm in case previous run consumed pending timers
    const spy2 = vi.spyOn(run2.service, 'pushFix');
    run2.simulator.play({ track: { gpxId: 'city' }, mutations: { noise_m: 20, seed: 42 } });
    vi.advanceTimersByTime(3000);
    const seq2 = spy2.mock.calls.map(([, pos]) => ({ lat: pos.lat, lon: pos.lon }));
    run2.simulator.dispose();
    run2.service.dispose();

    expect(seq2).toEqual(seq1);
  });

  it('outage suppresses fixes for exactly the configured window, resuming after', () => {
    const pushSpy = vi.spyOn(service, 'pushFix');
    simulator.play({ track: { gpxId: 'city' }, mutations: { outage: { at_s: 2, duration_s: 3 } } });
    vi.advanceTimersByTime(8000); // ticks t=0..7

    expect(pushSpy.mock.calls.length).toBe(5); // t=0,1,5,6,7 (2,3,4 suppressed)

    const pushedLats = pushSpy.mock.calls.map(([, pos]) => (pos as Position).lat);
    expect(pushedLats[0]).toBeCloseTo(sampleTrack(cityTrack, 0)!.lat, 6);
    expect(pushedLats[1]).toBeCloseTo(sampleTrack(cityTrack, 1)!.lat, 6);
    expect(pushedLats[2]).toBeCloseTo(sampleTrack(cityTrack, 5)!.lat, 6);
    expect(pushedLats[3]).toBeCloseTo(sampleTrack(cityTrack, 6)!.lat, 6);
    expect(pushedLats[4]).toBeCloseTo(sampleTrack(cityTrack, 7)!.lat, 6);
  });

  it('jump displaces exactly one fix by ~offset_m, then playback continues on-track', () => {
    const pushSpy = vi.spyOn(service, 'pushFix');
    simulator.play({ track: { gpxId: 'city' }, mutations: { jump: { at_s: 2, offset_m: 400 } } });
    vi.advanceTimersByTime(6000); // ticks t=0..5

    const positions = pushSpy.mock.calls.map(([, pos]) => pos as Position);
    expect(positions).toHaveLength(6);

    const jumpedDistance = haversineDistanceM(positions[2], sampleTrack(cityTrack, 2)!);
    expect(Math.abs(jumpedDistance - 400) / 400).toBeLessThan(0.05);

    // Before and after the jump tick, fixes stay on-track (jump is one-shot).
    for (const t of [0, 1, 3, 4, 5]) {
      const d = haversineDistanceM(positions[t], sampleTrack(cityTrack, t)!);
      expect(d).toBeLessThan(1);
    }
  });

  it('detour diverges the path from the original track after at_index', () => {
    const pushSpy = vi.spyOn(service, 'pushFix');
    simulator.play({
      track: { gpxId: 'city' },
      speed_factor: 50,
      mutations: { detour: { at_index: 2 } },
    });
    // Advance generously past the detoured track's total duration (original
    // ~100s track, detour shortens the tail); the tick loop self-stops once
    // sampleTrack returns null, so over-advancing is harmless.
    vi.advanceTimersByTime(100 * (1000 / 50));

    const positions = pushSpy.mock.calls.map(([, pos]) => pos as Position);
    expect(positions.length).toBeGreaterThan(45); // well past the original ~42.75s at_index=2 mark

    const lateFix = positions[positions.length - 1];
    const lateTickT = positions.length - 1;
    const originalAtSameTime = sampleTrack(cityTrack, lateTickT);
    const distanceFromOriginal = originalAtSameTime
      ? haversineDistanceM(lateFix, originalAtSameTime)
      : haversineDistanceM(lateFix, cityGpxPoints[cityGpxPoints.length - 1]);
    expect(distanceFromOriginal).toBeGreaterThan(150);
  });
});
