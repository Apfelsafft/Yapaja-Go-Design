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
 *
 * E10-T3 additions:
 *  - `GOLDEN_NIGHTLY=1` additionally includes `nightly_only` cases. Only the
 *    `eta` case is one today: it drives the GPS simulator at `speed_factor:
 *    1.0`, i.e. one second of wall clock per simulated second, which does not
 *    belong in a per-PR merge gate.
 *  - The non-live `describe` block now also asserts the DE set's required
 *    COMPOSITION (≥15 cases, ≥6 restrictions = height×3/weight×2/width×1).
 *    That check runs in every invocation — including the per-PR LI gate — so
 *    the DE safety set cannot be quietly shrunk even though its cases only
 *    execute nightly.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodePolyline6 } from './polyline.js';
import { geometryIntersectsBbox } from './bbox.js';
import { evaluateEta, expectedWallClockS } from './eta.js';
import {
  createProfile,
  getNavState,
  playSimulator,
  requestRoute,
  startNavigation,
  stopNavigation,
  stopSimulator,
  waitForCore,
  type RouteSummary,
} from './client.js';
import type {
  DistanceCase,
  EtaCase,
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
/**
 * E10-T3: opt-in for `nightly_only` cases (currently the ETA case, which burns
 * real wall clock at `speed_factor: 1.0`). The per-PR `golden-routes-li` gate
 * does NOT set this, so its runtime and `bail: 1` behaviour are unchanged.
 */
const NIGHTLY = process.env.GOLDEN_NIGHTLY === '1' || process.env.GOLDEN_NIGHTLY === 'true';

/** The one and only shipped curated set. Structural gates ALWAYS read this. */
const CANONICAL_FILE = resolve(__dirname, '..', 'golden-routes.json');

/**
 * Which file supplies the cases that get EXECUTED.
 *
 * `GOLDEN_ROUTES_FILE` exists for exactly one caller —
 * `scripts/runbook-smoke.sh`, which drives this same runner against a tiny
 * fixture set and a stub router to prove the acceptance gate goes red on a
 * lost restriction. No CI job sets it, so `golden-routes-li` /
 * `golden-routes-de` always run the canonical file.
 *
 * Crucially, the structural assertions below still read {@link CANONICAL_FILE}
 * regardless: pointing this variable at a trivial fixture can never make the
 * "DE set keeps its required composition" gate pass vacuously.
 */
const CASES_FILE = process.env.GOLDEN_ROUTES_FILE
  ? resolve(process.env.GOLDEN_ROUTES_FILE)
  : CANONICAL_FILE;

function loadCases(file: string): GoldenCase[] {
  const parsed = JSON.parse(readFileSync(file, 'utf-8')) as GoldenRoutesFile;
  return parsed.cases;
}

/** One log line per case so a CI run leaves an auditable trail of observations. */
function audit(msg: string): void {
  console.warn(`[golden:${REGION}] ${msg}`);
}

const allCases = loadCases(CASES_FILE);
/** Always the shipped set — the structural gates must not be overridable. */
const canonicalCases = CASES_FILE === CANONICAL_FILE ? allCases : loadCases(CANONICAL_FILE);
const cases = allCases.filter((c) => c.region === REGION && (NIGHTLY || !c.nightly_only));
const skippedNightly = allCases.filter((c) => c.region === REGION && c.nightly_only && !NIGHTLY);

describe(`Golden-Routes (region=${REGION}, core=${CORE_URL})`, () => {
  it('has at least one case for the selected region', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  /**
   * E10-T3 structural gate on the DE curated set (docs/07 §3b / tasks E10-T3:
   * "≥ 15 Fälle, ≥ 6 restriction-Fälle: Höhe×3, Gewicht×2, Breite×1").
   *
   * This assertion is deliberately independent of `GOLDEN_REGION` and of a
   * live Core: it runs in EVERY invocation of this suite — including the
   * per-PR LI gate — so nobody can shrink the DE safety set below its
   * required shape without a red build, even though the DE cases themselves
   * only execute in the nightly job.
   */
  it('DE set keeps its required composition (>=15 cases, >=6 restrictions: height x3, weight x2, width x1)', () => {
    const de = canonicalCases.filter((c) => c.region === 'de');
    const restrictions = de.filter((c): c is RestrictionCase => c.type === 'restriction');
    const byKind = (kind: RestrictionCase['restriction']['kind']): number =>
      restrictions.filter((c) => c.restriction.kind === kind).length;

    expect(de.length, 'DE case count').toBeGreaterThanOrEqual(15);
    expect(restrictions.length, 'DE restriction case count').toBeGreaterThanOrEqual(6);
    expect(byKind('maxheight'), 'DE maxheight cases').toBeGreaterThanOrEqual(3);
    expect(byKind('maxweight'), 'DE maxweight cases').toBeGreaterThanOrEqual(2);
    expect(byKind('maxwidth'), 'DE maxwidth cases').toBeGreaterThanOrEqual(1);
  });

  /** Ids must stay unique — they are the audit-trail key in CI logs. */
  it('has unique case ids', () => {
    const ids = canonicalCases.map((c) => c.id);
    expect(new Set(ids).size, `duplicate id(s) in golden-routes.json: ${ids.join(', ')}`).toBe(ids.length);
  });

  /**
   * An `eta` case consumes real wall clock (a simulated second is a real
   * second at factor 1.0), so it must never end up in the per-PR gate by
   * accident. Enforced here rather than by convention.
   */
  it('every eta case is marked nightly_only', () => {
    for (const c of canonicalCases) {
      if (c.type === 'eta') {
        expect(c.nightly_only, `${c.id}: eta cases must set nightly_only`).toBe(true);
      }
    }
  });
});

if (skippedNightly.length > 0) {
  console.warn(
    `[golden:${REGION}] skipping ${skippedNightly.length} nightly_only case(s) ` +
      `(${skippedNightly.map((c) => c.id).join(', ')}) — set GOLDEN_NIGHTLY=1 to include them.`,
  );
}

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
      case 'eta':
        // Wall-clock bound: the case's own cap plus slack for route/profile
        // setup, so a hung poll fails the CASE rather than the whole job.
        it(label, async () => runEta(c), (c.max_wall_clock_s + 120) * 1000);
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

/**
 * ETA-Plausibilität (docs/07 §3b, automated by E10-T3).
 *
 * Sequence — every step goes through the PUBLIC Core API, so the whole chain
 * (Valhalla timing → ETA math → calibration → published `nav/state`) is under
 * test, not just the pure `eta.ts` arithmetic:
 *   1. route the OD pair with the case profile;
 *   2. start navigation on that route id;
 *   3. replay the route's OWN geometry through the GPS simulator at exactly
 *      the planned average pace (`distance_m / duration_s`) and
 *      `speed_factor` (1.0 per spec);
 *   4. capture the FIRST published `eta` — the promise made to the driver;
 *   5. poll until `status === 'arrived'` and take the wall clock — the kept
 *      promise;
 *   6. `evaluateEta` decides whether the deviation is inside the 5 % budget.
 *
 * Failure modes are separated on purpose: a simulator/navigation breakdown
 * throws with its own message, so it can never be misread as "the ETA was
 * inaccurate".
 */
async function runEta(c: EtaCase): Promise<void> {
  const profileId = await createProfile(CORE_URL, c.profile);
  const routed = await requestRoute(CORE_URL, {
    origin: c.origin,
    destination: c.destination,
    profileId,
  });
  if (!routed.ok) {
    throw new Error(`${c.id}: expected a route, got ${routed.status} ${routed.code} ${routed.message}`);
  }
  const route = routed.routes[0];
  if (!route || route.duration_s <= 0 || route.distance_m <= 0) {
    throw new Error(`${c.id}: routing returned an unusable route: ${JSON.stringify(route)}`);
  }

  const budgetS = expectedWallClockS(route.duration_s, c.speed_factor);
  if (budgetS > c.max_wall_clock_s) {
    throw new Error(
      `${c.id}: route is too long for this case — planned ${route.duration_s.toFixed(0)}s at ` +
        `factor ${c.speed_factor} needs ~${budgetS.toFixed(0)}s wall clock, cap is ${c.max_wall_clock_s}s. ` +
        `Shorten the OD pair or raise max_wall_clock_s deliberately.`,
    );
  }

  const planSpeedMs = route.distance_m / route.duration_s;
  audit(
    `${c.id}: route distance=${route.distance_m.toFixed(0)}m planned=${route.duration_s.toFixed(0)}s ` +
      `-> simulator speed=${planSpeedMs.toFixed(2)}m/s at factor ${c.speed_factor}`,
  );

  try {
    await startNavigation(CORE_URL, route.id);
    await playSimulator(CORE_URL, {
      polyline6: route.geometry,
      speedMs: planSpeedMs,
      speedFactor: c.speed_factor,
    });

    // 4) First published ETA. Before the first position fix the Core reports
    //    `eta: null` — waiting for the first non-null value is what makes this
    //    the promise made at departure.
    const initialEtaMs = await pollFor(
      c.id,
      'the first non-null nav/state eta',
      30_000,
      async () => {
        const state = await getNavState(CORE_URL);
        return state.eta ? Date.parse(state.eta) : null;
      },
    );
    if (!Number.isFinite(initialEtaMs)) {
      throw new Error(`${c.id}: Core published an unparseable eta timestamp`);
    }
    audit(`${c.id}: initial eta=${new Date(initialEtaMs).toISOString()}`);

    // 5) Kept promise: wall clock at the moment the Core declares arrival.
    const actualArrivalMs = await pollFor(
      c.id,
      "nav/state status 'arrived'",
      c.max_wall_clock_s * 1000,
      async () => {
        const state = await getNavState(CORE_URL);
        return state.status === 'arrived' ? Date.now() : null;
      },
    );

    const verdict = evaluateEta(
      { initialEtaMs, actualArrivalMs, plannedDurationS: route.duration_s },
      c.max_eta_error,
    );
    audit(`${c.id}: ${verdict.summary}`);
    expect(
      verdict.pass,
      `${c.id}: ETA plausibility violated — ${verdict.summary}`,
    ).toBe(true);
  } finally {
    await stopSimulator(CORE_URL);
    await stopNavigation(CORE_URL);
  }
}

/**
 * Polls `read` every second until it yields a non-null value or `timeoutMs`
 * elapses. Event-driven waiting would be nicer, but the golden suite talks
 * plain REST on purpose (see `client.ts`); 1 Hz is the simulator's own fix
 * rate, so a finer poll would only add noise.
 */
async function pollFor(
  caseId: string,
  what: string,
  timeoutMs: number,
  read: () => Promise<number | null>,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${caseId}: timed out after ${(timeoutMs / 1000).toFixed(0)}s waiting for ${what}`);
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
