/**
 * LIVE integration test against a real Photon instance (E05-T4 acceptance
 * #1: "CI startet Photon-LI und E05-T1-Integration läuft dagegen").
 *
 * Gated behind `PHOTON_LIVE=1` (mirrors `GOLDEN_LIVE` in
 * e2e/golden-routes/runner.test.ts) -- entirely skipped without it, so
 * `pnpm test` / `npx vitest run` stays green and network-free in normal
 * development and in the `quality` CI job.
 *
 * A small Liechtenstein-ONLY prebuilt Photon index does not exist (neither
 * komoot/photon's own dumps at download1.graphhopper.com nor the
 * rtuszik/photon-docker mirror offer per-micro-state granularity -- see
 * services/photon/README.md "Warum kein LI-only-Index in CI" for the full
 * research trail). This test is therefore exercised for real only in
 * `.github/workflows/nightly.yml`'s `photon-li-nightly` job, which builds the
 * "switzerland-liechtenstein" index (the smallest real, obtainable region
 * that contains Liechtenstein/Vaduz) via `IMPORT_MODE=jsonl`. Per-PR CI
 * (`.github/workflows/ci.yml`'s `photon-setup` job) only proves the pieces
 * that ARE obtainable per-PR: script logic, compose config, and -Xmx wiring
 * -- see that job's comments.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_PHOTON_URL, PhotonBackend } from './photonBackend.js';
import { SearchService } from './service.js';
import { CoordsBackend } from './coordsBackend.js';

const LIVE = process.env.PHOTON_LIVE === '1' || process.env.PHOTON_LIVE === 'true';
const PHOTON_URL = process.env.PHOTON_URL ?? DEFAULT_PHOTON_URL;

// Vaduz, Liechtenstein -- same plausibility corridor already used by the
// Valhalla LI CI smoke test (services/valhalla, .github/workflows/ci.yml
// `valhalla-li-build`: "Vaduz->Schaan" uses 47.1410/9.5209 for Vaduz).
const VADUZ_LAT_MIN = 47.0;
const VADUZ_LAT_MAX = 47.3;
const VADUZ_LON_MIN = 9.3;
const VADUZ_LON_MAX = 9.7;

const noopRegionsProvider = { getInstalledRegions: async () => [] };

describe.skipIf(!LIVE)(`PhotonBackend live (real Photon @ ${PHOTON_URL})`, () => {
  it('finds "Vaduz" with a plausible lat/lon (PhotonBackend directly)', async () => {
    const backend = new PhotonBackend({ baseUrl: PHOTON_URL });

    const results = await backend.search({ q: 'Vaduz', limit: 5 });

    expect(results.length).toBeGreaterThan(0);
    const vaduz = results.find((r) => r.name.toLowerCase().includes('vaduz'));
    expect(vaduz, `expected a "Vaduz" hit among: ${JSON.stringify(results)}`).toBeDefined();
    expect(vaduz!.source).toBe('photon');
    expect(vaduz!.latlng.lat).toBeGreaterThan(VADUZ_LAT_MIN);
    expect(vaduz!.latlng.lat).toBeLessThan(VADUZ_LAT_MAX);
    expect(vaduz!.latlng.lon).toBeGreaterThan(VADUZ_LON_MIN);
    expect(vaduz!.latlng.lon).toBeLessThan(VADUZ_LON_MAX);
  });

  it('finds "Vaduz" through the full SearchService chain (E05-T1 integration)', async () => {
    const service = new SearchService({
      coordsBackend: new CoordsBackend(),
      photonBackend: new PhotonBackend({ baseUrl: PHOTON_URL }),
      regionsProvider: noopRegionsProvider,
    });

    const results = await service.search({ q: 'Vaduz', limit: 5 });

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.name.toLowerCase().includes('vaduz'))).toBe(true);
    expect(service.getBackendHealth().photon).toBe('ok');
  });

  it('reverse-geocodes a Vaduz coordinate to something plausible', async () => {
    const backend = new PhotonBackend({ baseUrl: PHOTON_URL });

    const results = await backend.reverse({ lat: 47.141, lon: 9.5215, limit: 1 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe('photon');
  });
});
