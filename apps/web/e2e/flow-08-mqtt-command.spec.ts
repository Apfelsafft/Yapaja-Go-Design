/**
 * docs/07 §5 — FLOW 8: "MQTT: mosquitto-Testcontainer; Kommando
 * `cmd/destination` ⇒ `nav/state` wird `navigating`; alle Status-Topics
 * erscheinen mit validen Payloads."
 *
 * Canonical proof for flow 8. See `e2e/FLOWS.md` for the full flow→spec table.
 *
 * This flow had NO e2e coverage before E10-T1 — MQTT was proven only at the
 * Core's own integration level (`apps/core/src/mqtt/bridge.integration.test.ts`),
 * never against a REAL running Core process with a browser attached, which is
 * what the flow describes (a command arrives from Home Assistant and the
 * vehicle's screen starts navigating).
 *
 * DOCUMENTED DEVIATION — "mosquitto-Testcontainer":
 * this repo has deliberately and repeatedly chosen an equivalent, Docker-free
 * path for MQTT, and documented why (see `bridge.integration.test.ts`'s
 * header: CI has no broker service and no testcontainers infrastructure). The
 * broker here is a REAL `aedes` broker on a real loopback TCP port
 * (`support/mqttBroker.ts`), the Core connects to it with the real `mqtt.js`
 * client, and this spec observes it with a SECOND real `mqtt.js` client
 * standing in for Home Assistant. Nothing about the MQTT protocol is mocked;
 * only the container around the broker is gone.
 *
 * END STATE ASSERTED BOTH WAYS:
 *  - MQTT/API: `yapaja/nav/state` really becomes `navigating` on the wire, and
 *    the Core's own `GET /api/v1/navigation/state` agrees; every status topic
 *    docs/03 §4 lists is checked for presence AND payload shape.
 *  - UI: the browser attached to that same Core switches into drive mode
 *    (maneuver panel) without anyone touching it — the command really drove
 *    the whole product, not just a bus topic.
 */

import { test, expect, type Page } from '@playwright/test';
import { connect as mqttConnect, type MqttClient } from 'mqtt';
import type { LatLon } from '../../core/src/routing/polyline.js';
import {
  FLOW8_CORE_BASE_URL,
  FLOW8_MQTT_BROKER_URL,
  FLOW8_MQTT_PREFIX,
  FLOW8_VALHALLA_PORT,
} from './support/constants.js';
import { collectPageErrors } from './support/network.js';
import { startValhallaStub, type ValhallaStub } from './support/valhallaStub.js';

// Inside the installed fixture region (lon 5.8-15.1, lat 47.2-55.1) -- the
// Core's routing coverage check rejects anything outside it.
const BASE_LAT = 47.4;
const BASE_LON = 9.6;
const M_PER_DEG_LAT = 111_195;
const STEP_M = 111.195;
const POINT_COUNT = 21;
const ROUTE_POINTS: LatLon[] = Array.from({ length: POINT_COUNT }, (_, i) => ({
  lat: BASE_LAT + (i * STEP_M) / M_PER_DEG_LAT,
  lon: BASE_LON,
}));
const DESTINATION = ROUTE_POINTS[POINT_COUNT - 1];
const ROUTE_LENGTH_KM = ((POINT_COUNT - 1) * STEP_M) / 1000;

/** Every retained status topic the bridge publishes (docs/03 §4). */
const STATUS_TOPICS = [
  'status',
  'position',
  'nav/state',
  'nav/eta',
  'nav/speed',
  'nav/altitude',
  'nav/destination',
  'route/summary',
] as const;

let valhallaStub: ValhallaStub;
let observer: MqttClient;
/** Latest payload seen per topic (retained + live), like a real HA would hold. */
const seen = new Map<string, string>();

function topic(suffix: string): string {
  return `${FLOW8_MQTT_PREFIX}/${suffix}`;
}

/** Waits until `predicate` holds for the latest payload of `t`. */
async function waitForTopic(
  t: string,
  predicate: (payload: string) => boolean,
  timeoutMs = 30_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = seen.get(t);
    if (value !== undefined && predicate(value)) return value;
    if (Date.now() > deadline) {
      throw new Error(
        `MQTT topic "${t}" never satisfied the predicate within ${timeoutMs}ms ` +
          `(last value: ${value ?? '<never published>'}; seen topics: ${[...seen.keys()].join(', ')})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

test.describe.serial('docs/07 §5 Flow 8 (MQTT cmd/destination)', () => {
  test.beforeAll(async () => {
    valhallaStub = await startValhallaStub(FLOW8_VALHALLA_PORT);
    valhallaStub.setNextTrip({
      points: ROUTE_POINTS,
      lengthKm: ROUTE_LENGTH_KM,
      timeS: 150,
      maneuvers: [
        {
          type: 8, // kContinue
          instruction: 'Der Bundesstraße folgen',
          street_names: ['Bundesstraße'],
          length: ROUTE_LENGTH_KM * 0.6,
          time: 90,
          begin_shape_index: 0,
        },
        {
          type: 15, // kLeft -> 'turn_left'
          instruction: 'Links abbiegen auf die Zielstraße',
          street_names: ['Zielstraße'],
          length: ROUTE_LENGTH_KM * 0.4,
          time: 60,
          begin_shape_index: 12,
        },
      ],
    });

    // The "Home Assistant" client.
    observer = mqttConnect(FLOW8_MQTT_BROKER_URL, { reconnectPeriod: 0 });
    await new Promise<void>((resolve, reject) => {
      observer.once('connect', () => resolve());
      observer.once('error', reject);
    });
    observer.on('message', (t, payload) => {
      seen.set(t, payload.toString('utf8'));
    });
    await new Promise<void>((resolve, reject) => {
      observer.subscribe(`${FLOW8_MQTT_PREFIX}/#`, { qos: 1 }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => observer.end(true, {}, () => resolve()));
    await valhallaStub.close();
  });

  test('[Flow 8] cmd/destination over MQTT makes nav/state "navigating", all status topics carry valid payloads, and the UI follows', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const pageErrors = collectPageErrors(page);

    // The bridge announces itself on connect -- proof the Core really is
    // talking to this broker before anything is asserted about commands.
    await waitForTopic(topic('status'), (v) => v === 'online');

    // An active profile is required to compute a route.
    const profileResponse = await page.request.post(`${FLOW8_CORE_BASE_URL}/api/v1/profiles`, {
      data: {
        name: 'Flow8 Camper',
        height_m: 3.2,
        width_m: 2.3,
        length_m: 7.0,
        weight_t: 3.5,
        avg_speed_kmh: 80,
        hazmat: false,
        avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
      },
    });
    expect(profileResponse.ok()).toBe(true);
    const profileId = ((await profileResponse.json()) as { data: { id: string } }).data.id;
    expect(
      (await page.request.put(`${FLOW8_CORE_BASE_URL}/api/v1/profiles/${profileId}/activate`)).ok(),
    ).toBe(true);

    // `cmd/destination` routes from `origin: 'current'`, so the Core needs a
    // current position. One real fix at the route's start point.
    const fixResponse = await page.request.post(
      `${FLOW8_CORE_BASE_URL}/api/v1/position/browser`,
      {
        data: {
          lat: ROUTE_POINTS[0].lat,
          lon: ROUTE_POINTS[0].lon,
          alt: 460,
          speed: 0,
          heading: 0,
          accuracy: 5,
          fix: '3d',
          ts: new Date().toISOString(),
        },
      },
    );
    expect(fixResponse.ok()).toBe(true);

    // A browser is attached to the SAME Core, doing nothing.
    await page.goto(FLOW8_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await expect(page.getByTestId('maneuver-panel')).toHaveCount(0);

    // --- the command --------------------------------------------------------
    await new Promise<void>((resolve, reject) => {
      observer.publish(
        topic('cmd/destination'),
        JSON.stringify({
          lat: DESTINATION.lat,
          lon: DESTINATION.lon,
          autostart: true,
          request_id: 'flow8-e2e',
        }),
        { qos: 1 },
        (err) => (err ? reject(err) : resolve()),
      );
    });

    // --- MQTT: nav/state becomes `navigating` --------------------------------
    await waitForTopic(topic('nav/state'), (v) => v === 'navigating', 40_000);

    // The command was acknowledged, with the request_id passed through
    // (docs/03 §4: "wird durchgereicht, wenn im Kommando enthalten").
    const cmdResult = JSON.parse(
      await waitForTopic(topic('cmd/result'), (v) => v.includes('flow8-e2e')),
    ) as { ok?: boolean; request_id?: string };
    expect(cmdResult.request_id).toBe('flow8-e2e');
    expect(cmdResult.ok).toBe(true);

    // --- API: the Core agrees --------------------------------------------------
    const navResponse = await page.request.get(`${FLOW8_CORE_BASE_URL}/api/v1/navigation/state`);
    expect(navResponse.ok()).toBe(true);
    const navState = ((await navResponse.json()) as { data: Record<string, unknown> }).data;
    expect(navState.status).toBe('navigating');
    expect(navState.route_id).toBeTruthy();

    // --- UI: the attached browser switched into drive mode by itself ---------
    await expect(page.getByTestId('maneuver-panel')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('maneuver-street')).toHaveText('Zielstraße', { timeout: 20_000 });

    // --- all status topics present, with VALID payloads ----------------------
    for (const suffix of STATUS_TOPICS) {
      await waitForTopic(topic(suffix), () => true, 20_000);
    }

    // `status`/`nav/state` are plain strings from a known set; everything else
    // is JSON with a specific shape (mqtt/mapping.ts).
    expect(seen.get(topic('status'))).toBe('online');
    expect(['idle', 'routing', 'navigating', 'paused', 'arrived', 'off_route']).toContain(
      seen.get(topic('nav/state')),
    );

    const position = JSON.parse(seen.get(topic('position')) as string) as Record<string, unknown>;
    expect(typeof position.lat).toBe('number');
    expect(typeof position.lon).toBe('number');
    expect(typeof position.ts).toBe('string');

    const eta = JSON.parse(seen.get(topic('nav/eta')) as string) as Record<string, unknown>;
    expect(Object.keys(eta).sort()).toEqual(
      ['distance_remaining_m', 'duration_remaining_s', 'eta'].sort(),
    );
    expect(eta.distance_remaining_m).not.toBeNull();

    const speed = JSON.parse(seen.get(topic('nav/speed')) as string) as Record<string, unknown>;
    expect(Object.keys(speed).sort()).toEqual(
      ['speed_kmh', 'speed_limit_kmh', 'speeding'].sort(),
    );
    expect(typeof speed.speeding).toBe('boolean');

    const altitude = JSON.parse(seen.get(topic('nav/altitude')) as string) as Record<string, unknown>;
    expect(Object.keys(altitude)).toEqual(['altitude_m']);

    const destination = JSON.parse(seen.get(topic('nav/destination')) as string) as Record<
      string,
      unknown
    >;
    expect(destination.lat).toBeCloseTo(DESTINATION.lat, 4);
    expect(destination.lon).toBeCloseTo(DESTINATION.lon, 4);
    expect('name' in destination).toBe(true);

    const summary = JSON.parse(seen.get(topic('route/summary')) as string) as Record<
      string,
      unknown
    >;
    expect(typeof summary.distance_m).toBe('number');
    expect(typeof summary.duration_s).toBe('number');
    expect(Array.isArray(summary.via)).toBe(true);
    // Plausibility (docs/07 §3a): a published route summary must describe a
    // real route, never zeros.
    expect(summary.distance_m as number).toBeGreaterThan(0);
    expect(summary.duration_s as number).toBeGreaterThan(0);

    expect(pageErrors).toEqual([]);
  });
});
