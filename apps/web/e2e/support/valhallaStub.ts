/**
 * Minimal stub Valhalla `/route` HTTP server for profile-reroute.spec.ts
 * (E06-T3, Flow 5).
 *
 * The profile-change reroute is triggered SERVER-SIDE: `NavigationService`
 * calls `RoutingService.createRoutes` in-process, which then dials
 * `VALHALLA_URL` directly from the Core's own Node process -- NOT through the
 * browser, so Playwright's `page.route()` (which only intercepts the
 * BROWSER's own fetches, see every other spec's routing mock) cannot reach
 * it. This tiny server stands in for the real Valhalla the dedicated
 * PROFILE_REROUTE_CORE_PORT core is pointed at (`VALHALLA_URL` env, see
 * `globalSetup.ts`), returning a single canned trip the test controls.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import type { LatLon } from '../../../core/src/routing/polyline.js';
import { encodePolyline6 } from '../../../core/src/routing/polyline.js';

/** Minimal Valhalla maneuver shape (`apps/core/src/routing/types.ts`
 *  `ValhallaManeuver`) -- only what `mapResponse.ts` reads. */
export interface ValhallaStubManeuver {
  /** Valhalla's integer maneuver-type enum (see `routing/maneuverMapping.ts`). */
  type: number;
  instruction?: string;
  street_names?: string[];
  /** kilometres. */
  length: number;
  time?: number;
  begin_shape_index: number;
}

export interface ValhallaStubTrip {
  points: LatLon[];
  /** kilometres (Valhalla's `units: "kilometers"` reply convention). */
  lengthKm: number;
  /** seconds. */
  timeS: number;
  /** E10-T1 (flow 3): maneuvers to return, so a REROUTE result can carry a
   *  genuinely new instruction for the UI to display. Defaults to `[]`,
   *  which is exactly what `profile-reroute.spec.ts` relied on before. */
  maneuvers?: ValhallaStubManeuver[];
}

/** Eine Kante, wie `speedSegmentsFromTraceAttributes` sie erwartet. */
export interface ValhallaStubEdge {
  begin_shape_index: number;
  end_shape_index: number;
  /** km/h, oder Valhallas „unlimited"; fehlt = kein Limit bekannt. */
  speed_limit?: number | 'unlimited';
}

export interface ValhallaStub {
  /** Base URL to point `VALHALLA_URL` at (already the case for the dedicated core, see `constants.ts`). */
  baseUrl: string;
  /** Sets the trip the NEXT `/route` call(s) resolve to. */
  setNextTrip(trip: ValhallaStubTrip): void;
  /**
   * Kanten fuer `/trace_attributes` -- daher kommen die Tempolimits einer
   * Route (`RoutingService.enrichWithSpeedLimits`).
   *
   * `null` (die Vorgabe) heisst: der Stub antwortet mit 404, der Client
   * meldet „keine Limits" und die Route bleibt ohne. Genau so verhielt sich
   * der Stub bisher, und jeder bestehende Aufrufer bekommt unveraendert
   * dieses Verhalten.
   */
  setTraceAttributesEdges(edges: ValhallaStubEdge[] | null): void;
  /** Number of `/route` POSTs received so far (proves a reroute was -- or wasn't -- attempted). */
  callCount(): number;
  /**
   * E10-T2: same instant as {@link lastCallAt}, but on the high-resolution
   * monotonic clock (`performance.now()`), in milliseconds with sub-microsecond
   * resolution. `Date.now()`'s 1 ms granularity is unusable for the perf
   * suite's reroute measurement, whose whole quantity is ~3 ms -- see
   * `e2e/perf/20-reroute.spec.ts`. Only meaningful when compared against
   * another `performance.now()` reading taken IN THE SAME PROCESS (the perf
   * suite's bus observer is).
   */
  lastCallAtHrMs(): number | null;
  /** Wall-clock ms of the most recent `/route` POST, or null if none yet.
   *  E10-T1 (flow 3): lets a spec time the reroute itself -- from the moment
   *  the Core actually asks the router, to the moment the new route is live --
   *  without a wall-clock guess. */
  lastCallAt(): number | null;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export interface ValhallaStubOptions {
  /**
   * E10-T2: artificial delay (ms) before the `/route` reply is written.
   *
   * Used ONLY by the perf suite's degradation proof
   * (`scripts/perf-degradation-proof.sh` / `PERF_DEGRADE_DELAY_MS`) to make a
   * genuine server-side latency regression appear on the reroute path. Every
   * existing caller omits it and gets exactly the previous behaviour.
   */
  delayMs?: number;
}

/** Starts the stub listening on `port`; resolves once it's actually listening. */
export async function startValhallaStub(
  port: number,
  options: ValhallaStubOptions = {},
): Promise<ValhallaStub> {
  const delayMs = options.delayMs ?? 0;
  let trip: ValhallaStubTrip | null = null;
  let calls = 0;
  let lastCallAt: number | null = null;
  let lastCallAtHr: number | null = null;
  let traceEdges: ValhallaStubEdge[] | null = null;

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/_calls') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ count: calls }));
      return;
    }
    if (req.method === 'POST' && req.url === '/trace_attributes') {
      // Ohne konfigurierte Kanten wie bisher: 404. Der Client faengt das ab
      // und laesst die Route ohne Limits -- eine Route soll nicht an einem
      // fehlenden Tempolimit scheitern.
      void readBody(req).then(() => {
        if (!traceEdges) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ edges: traceEdges }));
      });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/route') {
      res.writeHead(404);
      res.end();
      return;
    }
    void readBody(req).then(async () => {
      // Counted/stamped the moment the request ARRIVES -- `lastCallAt` is what
      // the reroute measurement uses as "the Core asked the router", so an
      // artificial `delayMs` must land AFTER this, inside the measured window.
      calls += 1;
      lastCallAt = Date.now();
      lastCallAtHr = performance.now();
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if (!trip) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'stub has no trip configured', error_code: 442 }));
        return;
      }
      const shape = encodePolyline6(trip.points);
      const body = {
        trip: {
          legs: [
            {
              shape,
              summary: { length: trip.lengthKm, time: trip.timeS },
              maneuvers: trip.maneuvers ?? [],
            },
          ],
          summary: { length: trip.lengthKm, time: trip.timeS },
          status: 0,
        },
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    setNextTrip: (t) => {
      trip = t;
    },
    setTraceAttributesEdges: (edges) => {
      traceEdges = edges;
    },
    callCount: () => calls,
    lastCallAt: () => lastCallAt,
    lastCallAtHrMs: () => lastCallAtHr,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
