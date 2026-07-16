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

export interface ValhallaStubTrip {
  points: LatLon[];
  /** kilometres (Valhalla's `units: "kilometers"` reply convention). */
  lengthKm: number;
  /** seconds. */
  timeS: number;
}

export interface ValhallaStub {
  /** Base URL to point `VALHALLA_URL` at (already the case for the dedicated core, see `constants.ts`). */
  baseUrl: string;
  /** Sets the trip the NEXT `/route` call(s) resolve to. */
  setNextTrip(trip: ValhallaStubTrip): void;
  /** Number of `/route` POSTs received so far (proves a reroute was -- or wasn't -- attempted). */
  callCount(): number;
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

/** Starts the stub listening on `port`; resolves once it's actually listening. */
export async function startValhallaStub(port: number): Promise<ValhallaStub> {
  let trip: ValhallaStubTrip | null = null;
  let calls = 0;

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/_calls') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ count: calls }));
      return;
    }
    if (req.method !== 'POST' || req.url !== '/route') {
      res.writeHead(404);
      res.end();
      return;
    }
    void readBody(req).then(() => {
      calls += 1;
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
              maneuvers: [],
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
    callCount: () => calls,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
