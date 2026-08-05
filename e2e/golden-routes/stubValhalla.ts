/**
 * Stub routing backend for `scripts/runbook-smoke.sh` (E10-T3).
 *
 * WHAT IT IS FOR — and what it is emphatically NOT for
 * ---------------------------------------------------
 * The data-update runbook's last step is "Golden-Routes as the acceptance
 * gate": a map update that loses a height restriction must not roll out. That
 * claim is worthless unless somebody has SEEN the gate go red for exactly that
 * reason. Building a real Valhalla graph to demonstrate it costs a multi-GB
 * download and hours of tile building, which no smoke test can do — so this
 * stub speaks Valhalla's `/route` wire format over HTTP and lets the smoke
 * script flip one bit: honour the height restriction, or ignore it.
 *
 * It is therefore a test of the GATE (runner → Core → profile→costing mapping
 * → geometry assertion), not of the map data. It NEVER takes part in the real
 * `golden-routes-li` / `golden-routes-de` jobs, which point the Core at a real
 * Valhalla. Nothing here may ever be presented as evidence about OSM.
 *
 * Wire contract implemented (see apps/core/src/routing/types.ts):
 *   POST /route  {locations:[{lat,lon}…], costing_options:{truck:{height,…}}}
 *          200 → {trip:{legs:[{shape,summary,maneuvers}],summary}}
 *   GET  /status 200 → {} (what the compose/CI health probes poll)
 *
 * Env:
 *   STUB_PORT              listen port (default 8002)
 *   STUB_MAX_HEIGHT_M      the modelled bridge clearance (default 3.2)
 *   STUB_REGRESSION        '1' = pretend the map update LOST the maxheight
 *                          tag: every vehicle is sent the direct way. This is
 *                          the OSM regression W-17/W-08 warn about, and the
 *                          smoke script asserts the gate turns red for it.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { encodePolyline6, type LonLat } from './polyline.js';

const PORT = Number(process.env.STUB_PORT ?? 8002);
const MAX_HEIGHT_M = Number(process.env.STUB_MAX_HEIGHT_M ?? 3.2);
const REGRESSION = process.env.STUB_REGRESSION === '1';

/**
 * The modelled world: a straight through-road with a low bridge in the
 * middle, and a longer bypass to the north that avoids it. Coordinates are
 * fictional (a flat patch near 48°N/11°E) — see the header: this is not map
 * data.
 */
const DIRECT: LonLat[] = [
  [11.0, 48.0],
  [11.0025, 48.0],
  [11.005, 48.0], // under the bridge
  [11.0075, 48.0],
  [11.01, 48.0],
];
const BYPASS: LonLat[] = [
  [11.0, 48.0],
  [11.001, 48.004],
  [11.005, 48.0042],
  [11.009, 48.004],
  [11.01, 48.0],
];

/** Simulated driving speed (m/s) — ~58 km/h, so the fixture trip lasts ~45 s. */
const SPEED_MS = 16;

const EARTH_RADIUS_M = 6371000;

function haversineM(a: LonLat, b: LonLat): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function pathLengthM(path: readonly LonLat[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineM(path[i - 1], path[i]);
  return total;
}

interface TruckCosting {
  height?: number;
  width?: number;
  weight?: number;
}

function buildTrip(path: readonly LonLat[]): unknown {
  const lengthKm = pathLengthM(path) / 1000;
  const timeS = (lengthKm * 1000) / SPEED_MS;
  return {
    trip: {
      status: 0,
      status_message: 'Found route between points',
      summary: { length: lengthKm, time: timeS },
      legs: [
        {
          shape: encodePolyline6(path),
          summary: { length: lengthKm, time: timeS },
          maneuvers: [
            {
              type: 1, // start
              instruction: 'Losfahren',
              street_names: ['Teststrasse'],
              length: lengthKm,
              time: timeS,
              begin_shape_index: 0,
              end_shape_index: path.length - 1,
            },
            {
              type: 4, // destination
              instruction: 'Sie haben Ihr Ziel erreicht',
              street_names: [],
              length: 0,
              time: 0,
              begin_shape_index: path.length - 1,
              end_shape_index: path.length - 1,
            },
          ],
        },
      ],
    },
  };
}

/**
 * The one decision this stub makes: does the requested vehicle fit under the
 * modelled bridge?
 *
 * In REGRESSION mode the height is simply never consulted — precisely what
 * happens when a fresh PBF has lost the `maxheight` tag on that way (W-08) or
 * when a profile→costing mapping stops forwarding the height (W-17's evil
 * twin). Both produce the same observable: the tall vehicle is routed under
 * the bridge, and the golden restriction case must fail.
 */
function choosePath(costing: TruckCosting): readonly LonLat[] {
  if (REGRESSION) return DIRECT;
  const height = typeof costing.height === 'number' ? costing.height : 0;
  return height > MAX_HEIGHT_M ? BYPASS : DIRECT;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

const server = createServer((req, res) => {
  void (async () => {
    if (req.method === 'GET' && req.url?.startsWith('/status')) {
      sendJson(res, 200, { version: 'stub', tileset_last_modified: 0 });
      return;
    }
    if (req.method !== 'POST' || !req.url?.startsWith('/route')) {
      sendJson(res, 404, { error_code: 404, error: 'stub: only POST /route and GET /status' });
      return;
    }

    let body: { costing_options?: { truck?: TruckCosting } };
    try {
      body = JSON.parse(await readBody(req)) as typeof body;
    } catch {
      sendJson(res, 400, { error_code: 400, error: 'stub: malformed JSON' });
      return;
    }

    const truck = body.costing_options?.truck ?? {};
    const path = choosePath(truck);
    console.warn(
      `[stub-valhalla] height=${truck.height ?? '?'} weight=${truck.weight ?? '?'} ` +
        `width=${truck.width ?? '?'} -> ${path === DIRECT ? 'DIRECT (under the bridge)' : 'BYPASS'}` +
        (REGRESSION ? '  [REGRESSION MODE: restriction ignored]' : ''),
    );
    sendJson(res, 200, buildTrip(path));
  })();
});

server.listen(PORT, () => {
  console.warn(
    `[stub-valhalla] listening on :${PORT} — modelled maxheight=${MAX_HEIGHT_M} m` +
      (REGRESSION ? ' — REGRESSION MODE (restriction dropped, gate must go RED)' : ''),
  );
});
