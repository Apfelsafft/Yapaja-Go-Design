/**
 * 🔴 Golden-Route runner (E03-T5) — Merge-Blocker ab Gate G2.
 *
 * Loads `e2e/golden-routes.json`, filters by `GOLDEN_REGION` (`li` | `de`,
 * default `li`), and drives each case against the CORE at `CORE_URL`
 * (default http://localhost:8080). Talking to the Core — not to Valhalla
 * directly — means the profile→truck-costing mapping (W-08) is under test too.
 *
 * This block needs a live Core + Valhalla, which does NOT exist in the unit
 * sandbox, so it is gated behind `GOLDEN_LIVE`. Locally, `pnpm golden-routes`
 * runs only the pure `bbox.test.ts` unit tests (green, no network); CI sets
 * `GOLDEN_LIVE=1` to run the route assertions.
 *
 * Config (`vitest.golden.config.ts`): `retry: 0`, `bail: 1` — a single failed
 * case (any safety/restriction case in particular) HARD-ABORTS the run with no
 * retry and no tolerance, per docs/07 §3b. The DE workflow additionally runs
 * `continue-on-error` while its cases are still `unverified` (see JSON header).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodePolyline6 } from './polyline.js';
import { geometryIntersectsBbox } from './bbox.js';
import { createProfile, requestRoute, waitForCore, type RouteSummary } from './client.js';
import type {
  DistanceCase,
  GoldenCase,
  GoldenRoutesFile,
  MonotonicCase,
  NoRouteCase,
  Region,
  RestrictionCase,
} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_URL = (process.env.CORE_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
const REGION = (process.env.GOLDEN_REGION ?? 'li') as Region;
const LIVE = process.env.GOLDEN_LIVE === '1' || process.env.GOLDEN_LIVE === 'true';

function loadCases(): GoldenCase[] {
  const file = resolve(__dirname, '..', 'golden-routes.json');
  const parsed = JSON.parse(readFileSync(file, 'utf-8')) as GoldenRoutesFile;
  return parsed.cases;
}

/** One log line per case so a CI run leaves an auditable trail of observations. */
function audit(msg: string): void {
  console.warn(`[golden:${REGION}] ${msg}`);
}

const allCases = loadCases();
const cases = allCases.filter((c) => c.region === REGION);

describe(`Golden-Routes (region=${REGION}, core=${CORE_URL})`, () => {
  it('has at least one case for the selected region', () => {
    expect(cases.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!LIVE)(`Golden-Routes live (region=${REGION})`, () => {
  beforeAll(async () => {
    await waitForCore(CORE_URL);
    audit(`Core healthy; running ${cases.length} case(s).`);
  }, 90_000);

  for (const c of cases) {
    const label = `${c.type}: ${c.id}${c.unverified ? ' (unverified)' : ''}`;

    switch (c.type) {
      case 'distance':
        it(label, async () => runDistance(c), 60_000);
        break;
      case 'restriction':
        it(label, async () => runRestriction(c), 90_000);
        break;
      case 'monotonic':
        it(label, async () => runMonotonic(c), 120_000);
        break;
      case 'no_route':
        it(label, async () => runNoRoute(c), 60_000);
        break;
    }
  }
});

// --- case runners --------------------------------------------------------

async function runDistance(c: DistanceCase): Promise<void> {
  const profileId = await createProfile(CORE_URL, c.profile);
  const result = await requestRoute(CORE_URL, {
    origin: c.origin,
    destination: c.destination,
    profileId,
  });
  if (!result.ok) {
    throw new Error(`${c.id}: expected a route, got ${result.status} ${result.code} ${result.message}`);
  }
  const route = result.routes[0];
  expect(route, `${c.id}: no route returned`).toBeTruthy();

  const lo = c.expected_distance_m * (1 - c.tolerance);
  const hi = c.expected_distance_m * (1 + c.tolerance);
  audit(
    `${c.id}: distance=${route.distance_m.toFixed(0)}m ` +
      `expected=${c.expected_distance_m}m ±${(c.tolerance * 100).toFixed(0)}% [${lo.toFixed(0)}..${hi.toFixed(0)}]`,
  );
  expect(route.distance_m).toBeGreaterThanOrEqual(lo);
  expect(route.distance_m).toBeLessThanOrEqual(hi);
}

async function runMonotonic(c: MonotonicCase): Promise<void> {
  const durations: number[] = [];
  for (const spec of c.profiles) {
    const profileId = await createProfile(CORE_URL, spec);
    const result = await requestRoute(CORE_URL, {
      origin: c.origin,
      destination: c.destination,
      profileId,
    });
    if (!result.ok) {
      throw new Error(
        `${c.id}: profile "${spec.name}" expected a route, got ${result.status} ${result.code} ${result.message}`,
      );
    }
    durations.push(result.routes[0].duration_s);
  }
  audit(`${c.id}: durations(s)=[${durations.map((d) => d.toFixed(0)).join(', ')}] (must be non-decreasing)`);

  for (let i = 1; i < durations.length; i++) {
    // Non-decreasing: a larger/heavier profile must never route FASTER than a
    // smaller one. Equality is allowed (small graphs often route identically);
    // a strict DROP is the swapped-mapping bug this case exists to catch. The
    // 1e-6 slack only absorbs float noise, not a real regression.
    expect(
      durations[i],
      `${c.id}: duration fell from profile[${i - 1}] (${durations[i - 1]}s) to profile[${i}] (${durations[i]}s)`,
    ).toBeGreaterThanOrEqual(durations[i - 1] - 1e-6);
  }
}

async function runRestriction(c: RestrictionCase): Promise<void> {
  // 1) small profile MUST route through the forbidden box (proves the box is
  //    actually on the natural path — otherwise the large-profile assertion is
  //    vacuous and we'd only be testing that Valhalla failed).
  const smallId = await createProfile(CORE_URL, c.small_profile);
  const small = await requestRoute(CORE_URL, {
    origin: c.origin,
    destination: c.destination,
    profileId: smallId,
  });
  if (!small.ok) {
    throw new Error(`${c.id}: small profile expected a route, got ${small.status} ${small.code}`);
  }
  const smallHits = routeHitsBbox(small.routes[0], c);
  audit(`${c.id}: small profile intersects forbidden_bbox = ${smallHits} (expected true)`);
  expect(smallHits, `${c.id}: small profile did NOT traverse the forbidden box; case is vacuous`).toBe(true);

  // 2) large profile MUST NOT enter the forbidden box. A NO_ROUTE for the
  //    large profile also satisfies the safety property (it cannot pass), so
  //    that counts as a pass; any OTHER error is a failure.
  const largeId = await createProfile(CORE_URL, c.large_profile);
  const large = await requestRoute(CORE_URL, {
    origin: c.origin,
    destination: c.destination,
    profileId: largeId,
  });
  if (!large.ok) {
    if (large.code === 'NO_ROUTE') {
      audit(`${c.id}: large profile got NO_ROUTE (cannot pass restriction) — safety satisfied`);
      return;
    }
    throw new Error(`${c.id}: large profile unexpected error ${large.status} ${large.code} ${large.message}`);
  }
  const largeHits = routeHitsBbox(large.routes[0], c);
  audit(`${c.id}: large profile intersects forbidden_bbox = ${largeHits} (expected false)`);
  expect(
    largeHits,
    `${c.id}: 🔴 SAFETY VIOLATION — large/heavy profile routed THROUGH the forbidden box`,
  ).toBe(false);
}

function routeHitsBbox(route: RouteSummary, c: RestrictionCase): boolean {
  const coords = decodePolyline6(route.geometry);
  return geometryIntersectsBbox(coords, c.forbidden_bbox);
}

async function runNoRoute(c: NoRouteCase): Promise<void> {
  const profileId = await createProfile(CORE_URL, c.profile);
  const result = await requestRoute(CORE_URL, {
    origin: c.origin,
    destination: c.destination,
    profileId,
  });
  audit(`${c.id}: ok=${result.ok}${result.ok ? '' : ` code=${result.code}`} (expected NO_ROUTE)`);
  expect(result.ok, `${c.id}: expected NO_ROUTE but a route was returned`).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe('NO_ROUTE');
  }
}
