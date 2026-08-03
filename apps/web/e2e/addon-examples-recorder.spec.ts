/**
 * E2E for the Track-Recorder reference add-on (E09-T5, docs/05 §6.2).
 * Installs the REAL, esbuild-built tarball produced by
 * `addons-examples/track-recorder/build.mjs`, enables it (spawning the real
 * `runtime: node20` service child process), drives a real
 * `POST /api/v1/simulator/play` run WITH a GPS-loss (`outage`) mutation,
 * starts/stops the recording through the add-on's own iframe UI, and proves:
 *
 *   1. The exported GPX is well-formed XML with the correct GPX 1.1 root +
 *      namespace and `<trk>/<trkseg>/<trkpt lat lon>` structure.
 *   2. THE SEGMENT-SPLIT RULE actually fired: the outage produced (at least)
 *      two non-empty `<trkseg>` elements -- a straight line was NEVER drawn
 *      across the simulated GPS loss.
 *   3. PLAUSIBILITY: the GPX's own haversine-summed distance is within ±2%
 *      of an INDEPENDENTLY computed "nominal" distance -- this test's own
 *      fresh haversine/segment-split implementation applied to a raw
 *      `pos/update` WebSocket subscription it opens itself (parallel to, and
 *      never through, the add-on's own code), filtered to the exact time
 *      window the recorded GPX's own first/last `<trkpt><time>` cover. Both
 *      the add-on's recorder and this test's independent subscriber see the
 *      EXACT SAME published fixes (the Core fans them out identically to
 *      every `/ws/v1` subscriber, `apps/core/src/position/service.ts`), so
 *      this is a genuine "does the add-on's own GPX correctly reflect what
 *      the Core actually broadcast" cross-check, not a guess at a
 *      theoretical route length.
 *
 * Runs against its own dedicated core (`ADDON_EXAMPLES_CORE_BASE_URL`),
 * shared with addon-examples-poi.spec.ts (two different add-on ids, so their
 * installs never collide) -- same "own port so the simulator-forced position
 * source never races another parallel spec" rationale as
 * SIMULATOR_CORE_PORT/DRIVE_CORE_PORT/etc. in constants.ts.
 */

import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADDON_EXAMPLES_CORE_BASE_URL, REPO_ROOT } from './support/constants.js';
import { collectPageErrors } from './support/network.js';
import { encodePolyline6 } from '../../core/src/position/simulator/polyline.js';

test.use({ serviceWorkers: 'allow' });

const ADDON_ID = 'com.yapaja.track-recorder';
const ADDON_DIR = join(REPO_ROOT, 'addons-examples', 'track-recorder');

// --- test track parameters --------------------------------------------------
// A single long straight leg (collinear sampling never loses distance to
// discretization, see distance.test.ts's reasoning) heading due east from a
// point in the same fixture region the rest of this harness uses.
const START = { lat: 47.4, lon: 9.5 };
const SPEED_MS = 15; // ~54 km/h, a plausible motorhome cruising speed
const PATH_LENGTH_M = 5000; // generous headroom over what the run below covers
const METERS_PER_DEGREE_LAT = 111320;
const END = {
  lat: START.lat,
  lon: START.lon + PATH_LENGTH_M / (METERS_PER_DEGREE_LAT * Math.cos((START.lat * Math.PI) / 180)),
};

const SPEED_FACTOR = 3;
const OUTAGE_AT_S = 15;
const OUTAGE_DURATION_S = 15; // real silence ~= 15/3 = 5s, well above the 3s split threshold
const RUN_TO_TICK_S = 50; // >= OUTAGE_AT_S + OUTAGE_DURATION_S, plus a tail after the gap

/** Mirrors `addons-examples/track-recorder/src/recorder.ts#GAP_THRESHOLD_MS`
 *  -- intentionally a SEPARATE constant (not imported), so this independent
 *  reference calculation cannot silently share a bug with the add-on's own. */
const GAP_THRESHOLD_MS = 3000;

interface Fix {
  lat: number;
  lon: number;
  ts: string;
}

declare global {
  interface Window {
    __testPosFixes?: Fix[];
    __testWs?: WebSocket;
  }
}

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

async function buildInstallAndEnable(page: Page): Promise<void> {
  execFileSync('node', ['build.mjs'], { cwd: ADDON_DIR, stdio: 'inherit' });
  const tarball = readFileSync(join(ADDON_DIR, 'dist', 'track-recorder.tgz'));

  const beginResponse = await page.request.post(`${ADDON_EXAMPLES_CORE_BASE_URL}/api/v1/addons/install`, {
    data: { source: 'upload', data: tarball.toString('base64') },
  });
  expect(beginResponse.status()).toBe(202);
  const begin = (await beginResponse.json()) as { data: { pending_id: string } };

  const confirmResponse = await page.request.post(
    `${ADDON_EXAMPLES_CORE_BASE_URL}/api/v1/addons/install/${begin.data.pending_id}/confirm`,
  );
  expect(confirmResponse.status()).toBe(201);

  const enableResponse = await page.request.post(`${ADDON_EXAMPLES_CORE_BASE_URL}/api/v1/addons/${ADDON_ID}/enable`);
  expect(enableResponse.status()).toBe(200);

  await page.evaluate(async () => {
    await window.__yapajaRefreshAddons?.();
  });
}

/** Opens a raw WebSocket to the Core's bus (same endpoint the add-on's own
 *  service uses) and collects every `pos/update` fix into
 *  `window.__testPosFixes`. Deliberately hand-rolled here (test-only code,
 *  not the add-on under test) -- opened BEFORE the simulator starts so no
 *  fix is missed. */
async function startIndependentPositionCollector(page: Page): Promise<void> {
  await page.evaluate((baseUrl) => {
    return new Promise<void>((resolve, reject) => {
      window.__testPosFixes = [];
      const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/ws/v1`;
      const ws = new WebSocket(wsUrl);
      window.__testWs = ws;
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'subscribe', topics: ['pos/update'] }));
        resolve();
      });
      ws.addEventListener('message', (event: MessageEvent) => {
        try {
          const frame = JSON.parse(String(event.data)) as { topic?: string; payload?: unknown };
          if (frame.topic === 'pos/update' && frame.payload && typeof frame.payload === 'object') {
            const p = frame.payload as { lat?: unknown; lon?: unknown; ts?: unknown };
            if (typeof p.lat === 'number' && typeof p.lon === 'number' && typeof p.ts === 'string') {
              window.__testPosFixes?.push({ lat: p.lat, lon: p.lon, ts: p.ts });
            }
          }
        } catch {
          /* ignore malformed frames */
        }
      });
      ws.addEventListener('error', () => reject(new Error('test WS connection failed')));
    });
  }, ADDON_EXAMPLES_CORE_BASE_URL);
}

async function waitForSimulatorTick(page: Page, targetTickS: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await page.request.get(`${ADDON_EXAMPLES_CORE_BASE_URL}/api/v1/simulator/status`);
    const body = (await res.json()) as { data: { tickS: number; state: string } };
    if (body.data.tickS >= targetTickS) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`simulator did not reach tickS=${targetTickS} within ${timeoutMs}ms`);
}

// --- independent reference implementation (haversine + segment split) ------
// Deliberately NOT imported from the add-on's own src/distance.ts or
// src/recorder.ts -- see the file-level doc comment.
const EARTH_RADIUS_M = 6371000;
function haversineMeters(a: Fix, b: Fix): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function splitIntoSegments(fixes: readonly Fix[], thresholdMs: number): Fix[][] {
  const segments: Fix[][] = [];
  let lastMs: number | null = null;
  for (const fix of fixes) {
    const ms = Date.parse(fix.ts);
    if (lastMs === null || ms - lastMs > thresholdMs) segments.push([]);
    segments[segments.length - 1].push(fix);
    lastMs = ms;
  }
  return segments;
}
function totalDistance(segments: readonly Fix[][]): number {
  let total = 0;
  for (const seg of segments) {
    for (let i = 1; i < seg.length; i++) total += haversineMeters(seg[i - 1], seg[i]);
  }
  return total;
}

test.describe('Track-Recorder reference add-on (E09-T5, docs/05 §6.2)', () => {
  test.describe.configure({ mode: 'serial' });

  test('install from the built tarball -> record a simulator drive through a GPS outage -> export a valid, segment-split, plausible GPX', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const pageErrors = collectPageErrors(page);

    await page.goto(ADDON_EXAMPLES_CORE_BASE_URL);
    await waitForMapReady(page);

    await buildInstallAndEnable(page);

    const frame = page.getByTestId(`addon-frame-${ADDON_ID}`);
    await expect(frame).toBeVisible({ timeout: 10_000 });
    const addonFrame = page.frameLocator(`iframe[data-testid="addon-frame-${ADDON_ID}"]`);
    const toggle = addonFrame.getByTestId('recorder-toggle');
    await expect(toggle).toBeVisible({ timeout: 10_000 });

    // --- start the independent ground-truth collector, THEN the simulator --
    await startIndependentPositionCollector(page);

    const playResponse = await page.request.post(`${ADDON_EXAMPLES_CORE_BASE_URL}/api/v1/simulator/play`, {
      data: {
        track: { polyline6: encodePolyline6([START, END]), speedMs: SPEED_MS },
        speed_factor: SPEED_FACTOR,
        mutations: { outage: { at_s: OUTAGE_AT_S, duration_s: OUTAGE_DURATION_S } },
      },
    });
    expect(playResponse.ok()).toBe(true);

    // --- start recording (the add-on's own UI, not a raw storage write) ----
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-recording', 'true', { timeout: 5_000 });

    // --- let the drive run through the outage and a bit beyond -------------
    await waitForSimulatorTick(page, RUN_TO_TICK_S, 60_000);

    // --- stop recording + the simulator -------------------------------------
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-recording', 'false', { timeout: 5_000 });
    await page.request.post(`${ADDON_EXAMPLES_CORE_BASE_URL}/api/v1/simulator/stop`);

    // --- export: open the (only) recorded track's GPX view ------------------
    const showButton = addonFrame.locator('[data-testid^="track-show-"]').first();
    await expect(showButton).toBeVisible({ timeout: 10_000 });
    await showButton.click();
    const gpxView = addonFrame.getByTestId('track-gpx-view');
    await expect(gpxView).not.toHaveText('', { timeout: 10_000 });
    const gpxText = (await gpxView.textContent()) ?? '';

    // --- criterion 1: well-formed XML, correct root/namespace, structure ---
    const parsed = await page.evaluate((xml) => {
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const parseError = doc.getElementsByTagName('parsererror').length > 0;
      const root = doc.documentElement;
      const trkSegs = Array.from(doc.getElementsByTagName('trkseg'));
      const points = trkSegs.map((seg) =>
        Array.from(seg.getElementsByTagName('trkpt')).map((pt) => ({
          lat: Number(pt.getAttribute('lat')),
          lon: Number(pt.getAttribute('lon')),
          ts: pt.getElementsByTagName('time')[0]?.textContent ?? '',
        })),
      );
      return {
        parseError,
        rootTag: root?.tagName ?? null,
        rootNs: root?.namespaceURI ?? null,
        trkCount: doc.getElementsByTagName('trk').length,
        segments: points,
      };
    }, gpxText);

    expect(parsed.parseError).toBe(false);
    expect(parsed.rootTag).toBe('gpx');
    expect(parsed.rootNs).toBe('http://www.topografix.com/GPX/1/1');
    expect(parsed.trkCount).toBe(1);

    // --- criterion 2: the segment-split rule actually fired ----------------
    const nonEmptySegments = parsed.segments.filter((seg) => seg.length > 0);
    expect(nonEmptySegments.length).toBeGreaterThanOrEqual(2);
    for (const seg of nonEmptySegments) {
      for (const pt of seg) {
        expect(Number.isFinite(pt.lat)).toBe(true);
        expect(Number.isFinite(pt.lon)).toBe(true);
        expect(pt.ts).not.toBe('');
      }
    }

    // --- criterion 3: distance plausibility, ±2% of the independent nominal
    const recordedDistance = totalDistance(nonEmptySegments);

    const allTs = nonEmptySegments.flatMap((seg) => seg.map((p) => p.ts));
    const firstTs = allTs.reduce((min, ts) => (Date.parse(ts) < Date.parse(min) ? ts : min));
    const lastTs = allTs.reduce((max, ts) => (Date.parse(ts) > Date.parse(max) ? ts : max));

    const independentFixes = (await page.evaluate(() => window.__testPosFixes ?? [])) as Fix[];
    await page.evaluate(() => window.__testWs?.close());
    const windowed = independentFixes.filter((f) => {
      const ms = Date.parse(f.ts);
      return ms >= Date.parse(firstTs) && ms <= Date.parse(lastTs);
    });
    const nominalSegments = splitIntoSegments(windowed, GAP_THRESHOLD_MS);
    const nominalDistance = totalDistance(nominalSegments);

    expect(nominalDistance).toBeGreaterThan(0);
    const relativeError = Math.abs(recordedDistance - nominalDistance) / nominalDistance;
    // `console.warn` (not `.log`) -- the repo's shared eslint config only
    // allows `warn`/`error` console methods (`eslint.config.js`'s `no-console`
    // rule); this line is diagnostic-only, surfaced on every run for the
    // task's report.
    console.warn(
      `[addon-examples-recorder] recordedDistance=${recordedDistance.toFixed(1)}m nominalDistance=${nominalDistance.toFixed(1)}m relativeError=${(relativeError * 100).toFixed(3)}%`,
    );
    expect(relativeError).toBeLessThanOrEqual(0.02);

    expect(pageErrors).toEqual([]);
  });
});
