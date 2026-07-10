/**
 * Unit tests for the pure gpsd TPV/SKY -> Position mapping (mode->fix,
 * accuracy from eph/epx/epy, missing fields, satellite counting).
 */

import { describe, it, expect } from 'vitest';
import { checkPosition, validatePosition } from '@yapaja/shared';
import { mapTpvToPosition, extractSatelliteCount, isGpsdTpv, isGpsdSky } from './mapping.js';

const FALLBACK_TS = '2026-07-10T10:00:00.000Z';

describe('isGpsdTpv / isGpsdSky', () => {
  it('discriminate by the class field', () => {
    expect(isGpsdTpv({ class: 'TPV' })).toBe(true);
    expect(isGpsdTpv({ class: 'SKY' })).toBe(false);
    expect(isGpsdSky({ class: 'SKY' })).toBe(true);
    expect(isGpsdSky({ class: 'TPV' })).toBe(false);
  });
});

describe('mapTpvToPosition', () => {
  it('maps a 3D fix (mode 3) with all fields present', () => {
    const pos = mapTpvToPosition(
      {
        class: 'TPV',
        mode: 3,
        lat: 52.520008,
        lon: 13.404954,
        altMSL: 37.4,
        speed: 12.3,
        track: 271.5,
        eph: 4.2,
        time: '2026-07-10T10:00:05.123Z',
      },
      FALLBACK_TS,
    );

    expect(pos).toEqual({
      lat: 52.520008,
      lon: 13.404954,
      alt: 37.4,
      speed: 12.3,
      heading: 271.5,
      accuracy: 4.2,
      source: 'gpsd',
      fix: '3d',
      ts: '2026-07-10T10:00:05.123Z',
    });
    expect(validatePosition(pos)).toBe(true);
    expect(checkPosition(pos!).ok).toBe(true);
  });

  it('maps a 2D fix (mode 2)', () => {
    const pos = mapTpvToPosition({ class: 'TPV', mode: 2, lat: 1, lon: 2 }, FALLBACK_TS);
    expect(pos?.fix).toBe('2d');
  });

  it('returns null for mode 0 (no fix)', () => {
    expect(mapTpvToPosition({ class: 'TPV', mode: 0, lat: 1, lon: 2 }, FALLBACK_TS)).toBeNull();
  });

  it('returns null for mode 1 (no fix)', () => {
    expect(mapTpvToPosition({ class: 'TPV', mode: 1, lat: 1, lon: 2 }, FALLBACK_TS)).toBeNull();
  });

  it('returns null when mode is missing entirely', () => {
    expect(mapTpvToPosition({ class: 'TPV', lat: 1, lon: 2 }, FALLBACK_TS)).toBeNull();
  });

  it('returns null when lat/lon are missing even if mode indicates a fix', () => {
    expect(mapTpvToPosition({ class: 'TPV', mode: 3 }, FALLBACK_TS)).toBeNull();
    expect(mapTpvToPosition({ class: 'TPV', mode: 3, lat: 1 }, FALLBACK_TS)).toBeNull();
  });

  it('defaults alt/speed/heading/accuracy to null when absent', () => {
    const pos = mapTpvToPosition({ class: 'TPV', mode: 3, lat: 1, lon: 2 }, FALLBACK_TS);
    expect(pos).toEqual({
      lat: 1,
      lon: 2,
      alt: null,
      speed: null,
      heading: null,
      accuracy: null,
      source: 'gpsd',
      fix: '3d',
      ts: FALLBACK_TS,
    });
  });

  it('treats a NaN/non-finite track as a missing heading', () => {
    const pos = mapTpvToPosition(
      { class: 'TPV', mode: 3, lat: 1, lon: 2, track: NaN },
      FALLBACK_TS,
    );
    expect(pos?.heading).toBeNull();
  });

  it('prefers altMSL over alt when both are present', () => {
    const pos = mapTpvToPosition(
      { class: 'TPV', mode: 3, lat: 1, lon: 2, altMSL: 100, alt: 50 },
      FALLBACK_TS,
    );
    expect(pos?.alt).toBe(100);
  });

  it('falls back to alt when altMSL is absent', () => {
    const pos = mapTpvToPosition({ class: 'TPV', mode: 3, lat: 1, lon: 2, alt: 50 }, FALLBACK_TS);
    expect(pos?.alt).toBe(50);
  });

  it('uses eph for accuracy when present', () => {
    const pos = mapTpvToPosition(
      { class: 'TPV', mode: 3, lat: 1, lon: 2, eph: 3, epx: 99, epy: 99 },
      FALLBACK_TS,
    );
    expect(pos?.accuracy).toBe(3);
  });

  it('falls back to max(epx, epy) when eph is absent', () => {
    const pos = mapTpvToPosition(
      { class: 'TPV', mode: 3, lat: 1, lon: 2, epx: 6, epy: 9 },
      FALLBACK_TS,
    );
    expect(pos?.accuracy).toBe(9);
  });

  it('uses whichever of epx/epy is present when only one is', () => {
    expect(
      mapTpvToPosition({ class: 'TPV', mode: 3, lat: 1, lon: 2, epx: 6 }, FALLBACK_TS)?.accuracy,
    ).toBe(6);
    expect(
      mapTpvToPosition({ class: 'TPV', mode: 3, lat: 1, lon: 2, epy: 7 }, FALLBACK_TS)?.accuracy,
    ).toBe(7);
  });

  it('falls back to the provided timestamp when time is missing or unparseable', () => {
    expect(mapTpvToPosition({ class: 'TPV', mode: 3, lat: 1, lon: 2 }, FALLBACK_TS)?.ts).toBe(
      FALLBACK_TS,
    );
    expect(
      mapTpvToPosition({ class: 'TPV', mode: 3, lat: 1, lon: 2, time: 'not-a-date' }, FALLBACK_TS)
        ?.ts,
    ).toBe(FALLBACK_TS);
  });
});

describe('extractSatelliteCount', () => {
  it('counts the satellites array', () => {
    expect(extractSatelliteCount({ class: 'SKY', satellites: [1, 2, 3, 4] })).toBe(4);
  });

  it('returns null when satellites is absent or not an array', () => {
    expect(extractSatelliteCount({ class: 'SKY' })).toBeNull();
    expect(extractSatelliteCount({ class: 'SKY', satellites: 'nope' })).toBeNull();
  });
});
