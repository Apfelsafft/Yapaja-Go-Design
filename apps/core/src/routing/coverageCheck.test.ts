/**
 * Tests for coverage check (E03-T6).
 *
 * Covers:
 * - Point-in-BBox logic (including boundary cases)
 * - Finding covering regions
 * - OUT_OF_COVERAGE error with missing_region_hint
 * - Multiple points (origin, destination, waypoints)
 */

import { describe, it, expect } from 'vitest';
import type { LatLng } from '@yapaja/shared';
import { checkCoverage, type InstalledRegionsProvider } from './coverageCheck.js';
import { RoutingError } from './errors.js';

// --- Fixtures -------------------------------------------------------

const REGION_LI = {
  id: 'li',
  name: 'Liechtenstein',
  bounds: [9.47, 47.04, 9.64, 47.27] as [number, number, number, number],
};

const REGION_AT = {
  id: 'at',
  name: 'Österreich',
  bounds: [9.5, 46.4, 17.1, 49.0] as [number, number, number, number],
};

const REGION_CH = {
  id: 'ch',
  name: 'Schweiz',
  bounds: [5.96, 45.82, 10.49, 47.81] as [number, number, number, number],
};

function mockProvider(
  installed: typeof REGION_LI[] = [],
  catalog: typeof REGION_LI[] = [],
): InstalledRegionsProvider {
  return {
    getInstalledRegions: async () => installed,
    getCatalogRegions: async () => catalog,
  };
}

// --- Tests -------------------------------------------------------

describe('checkCoverage', () => {
  describe('Point-in-BBox logic (boundary cases)', () => {
    it('accepts a point exactly on the boundary', async () => {
      const provider = mockProvider([REGION_LI]);
      const point: LatLng = { lat: 47.04, lon: 9.47 }; // minLat, minLon corner

      await expect(checkCoverage(point, point, [], provider)).resolves.not.toThrow();
    });

    it('accepts a point inside the bounds', async () => {
      const provider = mockProvider([REGION_LI]);
      const point: LatLng = { lat: 47.15, lon: 9.55 }; // center

      await expect(checkCoverage(point, point, [], provider)).resolves.not.toThrow();
    });

    it('rejects a point outside the bounds', async () => {
      const provider = mockProvider([REGION_LI]);
      const point: LatLng = { lat: 48.0, lon: 10.0 }; // outside

      try {
        await checkCoverage(null, point, [], provider);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RoutingError);
      }
    });
  });

  describe('Destination coverage', () => {
    it('allows destination within installed region', async () => {
      const provider = mockProvider([REGION_LI]);
      const dest: LatLng = { lat: 47.15, lon: 9.55 };

      await expect(checkCoverage(null, dest, [], provider)).resolves.not.toThrow();
    });

    it('rejects destination outside installed regions', async () => {
      const provider = mockProvider([REGION_LI]);
      const dest: LatLng = { lat: 48.0, lon: 12.0 }; // somewhere in Austria, not installed

      try {
        await checkCoverage(null, dest, [], provider);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RoutingError);
        expect((err as RoutingError).code).toBe('OUT_OF_COVERAGE');
      }
    });
  });

  describe('Origin coverage', () => {
    it('allows origin within installed region', async () => {
      const provider = mockProvider([REGION_LI]);
      const origin: LatLng = { lat: 47.15, lon: 9.55 };
      const dest: LatLng = { lat: 47.1, lon: 9.5 };

      await expect(checkCoverage(origin, dest, [], provider)).resolves.not.toThrow();
    });

    it('rejects origin outside installed regions', async () => {
      const provider = mockProvider([REGION_LI]);
      const origin: LatLng = { lat: 48.0, lon: 12.0 }; // outside
      const dest: LatLng = { lat: 47.15, lon: 9.55 }; // inside

      try {
        await checkCoverage(origin, dest, [], provider);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RoutingError);
        expect((err as RoutingError).code).toBe('OUT_OF_COVERAGE');
      }
    });

    it('allows null origin (will be resolved later by service)', async () => {
      const provider = mockProvider([REGION_LI]);
      const dest: LatLng = { lat: 47.15, lon: 9.55 };

      await expect(checkCoverage(null, dest, [], provider)).resolves.not.toThrow();
    });
  });

  describe('Waypoints coverage', () => {
    it('allows all waypoints within installed region', async () => {
      const provider = mockProvider([REGION_LI]);
      const origin: LatLng = { lat: 47.1, lon: 9.5 };
      const dest: LatLng = { lat: 47.2, lon: 9.6 };
      const waypoints: LatLng[] = [
        { lat: 47.15, lon: 9.55 },
        { lat: 47.12, lon: 9.52 },
      ];

      await expect(checkCoverage(origin, dest, waypoints, provider)).resolves.not.toThrow();
    });

    it('rejects if one waypoint is outside', async () => {
      const provider = mockProvider([REGION_LI]);
      const origin: LatLng = { lat: 47.1, lon: 9.5 };
      const dest: LatLng = { lat: 47.2, lon: 9.6 };
      const waypoints: LatLng[] = [
        { lat: 47.15, lon: 9.55 }, // inside
        { lat: 48.0, lon: 12.0 }, // outside
      ];

      try {
        await checkCoverage(origin, dest, waypoints, provider);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RoutingError);
        expect((err as RoutingError).code).toBe('OUT_OF_COVERAGE');
      }
    });
  });

  describe('Multiple installed regions', () => {
    it('accepts point covered by any installed region', async () => {
      const provider = mockProvider([REGION_LI, REGION_AT, REGION_CH]);
      const dest: LatLng = { lat: 47.5, lon: 8.5 }; // in CH

      await expect(checkCoverage(null, dest, [], provider)).resolves.not.toThrow();
    });

    it('checks all points against all regions', async () => {
      const provider = mockProvider([REGION_LI, REGION_AT]);
      const origin: LatLng = { lat: 47.15, lon: 9.55 }; // LI
      const dest: LatLng = { lat: 48.2, lon: 16.5 }; // AT
      const waypoints: LatLng[] = [{ lat: 47.5, lon: 15.0 }]; // AT

      await expect(checkCoverage(origin, dest, waypoints, provider)).resolves.not.toThrow();
    });
  });

  describe('missing_region_hint', () => {
    it('adds missing_region_hint if a matching catalog region exists', async () => {
      const provider = mockProvider([REGION_LI], [REGION_LI, REGION_AT, REGION_CH]);
      const dest: LatLng = { lat: 48.2, lon: 16.5 }; // inside AT, not installed

      try {
        await checkCoverage(null, dest, [], provider);
        expect.fail('should have thrown');
      } catch (err) {
        const routingErr = err as RoutingError & { missing_region_hint?: string };
        expect(routingErr.code).toBe('OUT_OF_COVERAGE');
        expect(routingErr.missing_region_hint).toContain('Österreich');
      }
    });

    it('sets generic hint if no catalog region matches', async () => {
      const provider = mockProvider([REGION_LI], []); // empty catalog
      const dest: LatLng = { lat: 48.2, lon: 16.5 }; // not in any region

      try {
        await checkCoverage(null, dest, [], provider);
        expect.fail('should have thrown');
      } catch (err) {
        const routingErr = err as RoutingError & { missing_region_hint?: string };
        expect(routingErr.code).toBe('OUT_OF_COVERAGE');
        expect(routingErr.missing_region_hint).toContain('keine passende Region');
      }
    });
  });

  describe('Edge case: no installed regions', () => {
    it('allows any point if no regions are installed (fail open)', async () => {
      const provider = mockProvider([], []);
      const dest: LatLng = { lat: 48.2, lon: 16.5 };

      // With no installed regions, we skip the check (shouldn't happen in practice).
      await expect(checkCoverage(null, dest, [], provider)).resolves.not.toThrow();
    });
  });
});
