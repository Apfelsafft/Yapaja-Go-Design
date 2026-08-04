/**
 * [Perf] Reroute-Latenz nach bestaetigter Abweichung -- Budget < 3 s
 * (docs/00, Wargame W-05).
 *
 * Der Messweg ist derselbe, den `apps/web/e2e/flow-03-wrong-turn-reroute.spec.ts`
 * (E10-T1) etabliert hat, und aus demselben Grund:
 *
 *  - Die Abweichung entsteht durch eine ECHTE Simulator-Mutation
 *    (`mutations.detour`), nicht durch handgefuetterte "tu so als waerst du
 *    daneben"-Fixes.
 *  - Der Reroute wird SERVERSEITIG ausgeloest (`NavigationService` ruft
 *    `RoutingService.createRoutes` im Core-Prozess auf), `page.route()` kann
 *    ihn deshalb nicht erreichen -- der Core zeigt hier auf einen
 *    Stub-Valhalla, den diese Datei selbst betreibt.
 *  - GEMESSEN wird von dem Moment, in dem der Core den Router tatsaechlich
 *    fragt, bis der Core die neue Route als `nav/state` auf dem Event-Bus
 *    veroeffentlicht (siehe `waitForNavState` fuer die Herleitung des
 *    Messpunkts). Das ~5-s-Bestaetigungsfenster
 *    davor (CONFIRM_MIN_MS / CONFIRM_MIN_FIXES) ist eine sicherheitskritische
 *    Entprellung und ausdruecklich KEINE Reroute-Latenz; es wird berichtet,
 *    aber nicht gegen ein Budget gerechnet, das es nie meinte.
 *
 * Wiederholt `ITERATIONS`-mal; Kennzahl ist das interquartile Mittel.
 */

import { test, expect, type Page } from '@playwright/test';
import type { Route } from '@yapaja/shared';
import { encodePolyline6, type LatLon } from '../../apps/core/src/routing/polyline.js';
import { startValhallaStub, type ValhallaStub } from '../../apps/web/e2e/support/valhallaStub.js';
import {
  PERF_CORE_BASE_URL,
  PERF_VALHALLA_PORT,
  PERF_VIEWPORT,
  degradeDelayMs,
} from './support/constants.js';
import {
  installDegradation,
  releasePositionSource,
  throttleCpu,
  waitForMapLoaded,
} from './support/page.js';
import { recordAndAssert } from './support/measure.js';
import { observeBus, type BusObserver } from './support/wsObserver.js';
import { interquartileMean, median } from './statistics.js';

const ITERATIONS = 5;

// Innerhalb der installierten Fixture-Region (lon 5.8-15.1, lat 47.2-55.1):
// der Core lehnt eine Route ausserhalb der Kartenabdeckung ab -- das ist die
// Abdeckungspruefung, die ihre Arbeit tut, und nicht etwas, das die Messung
// umgehen darf.
const BASE_LAT = 47.35;
const BASE_LON = 9.55;
const M_PER_DEG_LAT = 111_195;
const STEP_M = 111.195;
const POINT_COUNT = 31;
const TOTAL_LENGTH_M = (POINT_COUNT - 1) * STEP_M;
const TRACK_DURATION_S = 220;
const WRONG_TURN_AT_INDEX = 2;
const TRACK_SPEED_MS = 6;
const SPEED_FACTOR = 3;
const DETOUR_EAST_DEG = 0.004;

const ROUTE_POINTS: LatLon[] = Array.from({ length: POINT_COUNT }, (_, i) => ({
  lat: BASE_LAT + (i * STEP_M) / M_PER_DEG_LAT,
  lon: BASE_LON,
}));

const REROUTED_POINTS: LatLon[] = [
  ...Array.from({ length: POINT_COUNT - WRONG_TURN_AT_INDEX }, (_, i) => ({
    lat: BASE_LAT + ((WRONG_TURN_AT_INDEX + i) * STEP_M) / M_PER_DEG_LAT,
    lon: BASE_LON + DETOUR_EAST_DEG,
  })),
  { lat: BASE_LAT + ((POINT_COUNT - 1) * STEP_M) / M_PER_DEG_LAT, lon: BASE_LON },
];
const REROUTED_LENGTH_KM = ((POINT_COUNT - 1 - WRONG_TURN_AT_INDEX) * STEP_M + 300) / 1000;

function originalRoute(iteration: number): Route {
  return {
    id: `perf-reroute-original-${iteration}`,
    distance_m: TOTAL_LENGTH_M,
    duration_s: TRACK_DURATION_S,
    geometry: encodePolyline6(ROUTE_POINTS),
    legs: [{ index: 0, distance_m: TOTAL_LENGTH_M, duration_s: TRACK_DURATION_S }],
    maneuvers: [
      {
        index: 0,
        type: 'continue',
        instruction: 'Der Rheinstraße folgen',
        street_names: ['Rheinstraße'],
        distance_m: 20 * STEP_M,
        begin_shape_index: 0,
      },
      {
        index: 1,
        type: 'turn_left',
        instruction: 'Links abbiegen auf die Originalstraße',
        street_names: ['Originalstraße'],
        distance_m: 10 * STEP_M,
        begin_shape_index: 20,
      },
    ],
    speed_limits: [],
    warnings: [],
  };
}

interface ApiNavState {
  status: string;
  route_id: string | null;
}

async function apiNavState(page: Page): Promise<ApiNavState> {
  const response = await page.request.get(`${PERF_CORE_BASE_URL}/api/v1/navigation/state`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { data: ApiNavState }).data;
}

/**
 * Wartet EREIGNISGETRIEBEN darauf, dass im UI eine andere Route aktiv ist.
 *
 * Dient als UI-seitige ENDZUSTANDS-Pruefung (docs/07-Regel: jeder Flow prueft
 * ueber API UND UI), NICHT als Messpunkt -- warum nicht, steht bei
 * `waitForNavState`.
 */
async function waitForNewRouteInUi(
  page: Page,
  originalRouteId: string,
  timeoutMs: number,
): Promise<number> {
  return page.evaluate(
    ({ routeId, timeout }: { routeId: string; timeout: number }) => {
      const store = window.__yapajaNavStore;
      if (!store) throw new Error('Nav-Store nicht verfuegbar');
      const isNew = (id: string | null | undefined): boolean => Boolean(id && id !== routeId);
      if (isNew(store.getState().navState?.route_id)) {
        return Promise.resolve(Date.now());
      }
      return new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => {
          unsubscribe();
          reject(new Error(`Im UI wurde binnen ${timeout} ms keine neue Route aktiv`));
        }, timeout);
        const unsubscribe = store.subscribe((state) => {
          if (isNew(state.navState?.route_id)) {
            clearTimeout(timer);
            unsubscribe();
            resolve(Date.now());
          }
        });
      });
    },
    { routeId: originalRouteId, timeout: timeoutMs },
  );
}

/**
 * MESSPUNKT: das `nav/state`-Ereignis auf dem Core-Event-Bus, abgehoert aus
 * dem NODE-Prozess (`support/wsObserver.ts`).
 *
 * DREI MESSAUFBAU-KORREKTUREN STECKEN DARIN, alle aus echten Laeufen dieser
 * Suite und alle am AUFBAU statt an der Schwelle:
 *
 *  1. Erste Fassung: REST-Polling alle 75 ms. Die Reroute-Latenz selbst liegt
 *     bei ~11 ms -- die Abtastung war groesser als die Messgroesse, der
 *     Messwert also "wahre Latenz + Gleichverteilung(0, 75 ms)". Zwei Laeufe
 *     meldeten 77 ms und 31 ms: 85 % Streuung.
 *  2. Zweite Fassung: `nav/state` ueber den BROWSER-Store. Stichproben
 *     [242, 125, 216, 10, 251] ms -- der Messcontainer rastert in Software,
 *     ein Frame dauert ~110 ms, und die WS-Nachricht wartet darauf. Gemessen
 *     wurde die Frame-Zeit.
 *  3. Dritte Fassung: REST-Polling alle 5 ms. Besser (10 vs. 12 ms), aber
 *     immer noch 18 % Streuung -- die HTTP-Umlaufzeit selbst liegt in der
 *     Groessenordnung der Messgroesse.
 *
 * Endfassung: derselbe Bus, an dem auch das UI haengt, direkt aus Node
 * abgehoert -- keine Drosselung, kein Rendering, kein Polling. Dass die neue
 * Anweisung auch in der Oberflaeche ankommt, wird separat geprueft
 * (`waitForNewRouteInUi`), und der Core-Zustand zusaetzlich ueber die REST-API.
 */
async function waitForNavState(
  page: Page,
  predicate: (state: ApiNavState) => boolean,
  timeoutMs: number,
  pollIntervalMs = 100,
): Promise<{ at: number; state: ApiNavState }> {
  const deadline = Date.now() + timeoutMs;
  let last: ApiNavState | null = null;
  for (;;) {
    const state = await apiNavState(page);
    last = state;
    if (predicate(state)) return { at: Date.now(), state };
    if (Date.now() > deadline) {
      throw new Error(
        `Nav-Zustand trat nicht innerhalb von ${timeoutMs} ms ein; zuletzt: ${JSON.stringify(last)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

let valhallaStub: ValhallaStub;
let bus: BusObserver;

test.beforeAll(async () => {
  // Der Delay des Degradations-Fixtures gilt auch fuer den serverseitigen
  // Routing-Aufruf -- sonst waere die Reroute-Metrik als einzige gegen die
  // kuenstliche Verschlechterung immun.
  valhallaStub = await startValhallaStub(PERF_VALHALLA_PORT, { delayMs: degradeDelayMs() });
  bus = await observeBus(PERF_CORE_BASE_URL, ['nav/state']);
});

test.afterAll(async () => {
  await bus.close();
  await valhallaStub.close();
});

test('[Perf] Reroute nach Abweichung < 3 s', async ({ browser, request }) => {
  const profileResponse = await request.post(`${PERF_CORE_BASE_URL}/api/v1/profiles`, {
    data: {
      name: 'Perf Camper',
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
  expect((await request.put(`${PERF_CORE_BASE_URL}/api/v1/profiles/${profileId}/activate`)).ok()).toBe(
    true,
  );

  const context = await browser.newContext({
    viewport: { ...PERF_VIEWPORT },
    serviceWorkers: 'block',
  });
  const rerouteSamples: number[] = [];
  const confirmSamples: number[] = [];

  try {
    const page = await context.newPage();
    await throttleCpu(context, page);
    await installDegradation(page);
    await page.goto(`${PERF_CORE_BASE_URL}/`, { timeout: 120_000 });
    await waitForMapLoaded(page);

    for (let i = 0; i < ITERATIONS; i += 1) {
      const route = originalRoute(i);
      valhallaStub.setNextTrip({
        points: REROUTED_POINTS,
        lengthKm: REROUTED_LENGTH_KM,
        timeS: 240,
        maneuvers: [
          {
            type: 8,
            instruction: 'Der Ausweichstrecke folgen',
            street_names: ['Ausweichstrecke'],
            length: 0.5,
            time: 80,
            begin_shape_index: 0,
          },
          {
            type: 10,
            instruction: 'Rechts abbiegen auf den Umleitungsweg',
            street_names: ['Umleitungsweg'],
            length: REROUTED_LENGTH_KM - 0.5,
            time: 160,
            begin_shape_index: 5,
          },
        ],
      });
      const callsBefore = valhallaStub.callCount();

      expect(
        (
          await request.post(`${PERF_CORE_BASE_URL}/api/v1/navigation/start`, {
            data: {
              route,
              destination: { latlng: ROUTE_POINTS[POINT_COUNT - 1], name: 'Perf Ziel' },
            },
          })
        ).ok(),
      ).toBe(true);

      expect(
        (
          await request.post(`${PERF_CORE_BASE_URL}/api/v1/simulator/play`, {
            data: {
              track: { polyline6: route.geometry, speedMs: TRACK_SPEED_MS },
              speed_factor: SPEED_FACTOR,
              mutations: { detour: { at_index: WRONG_TURN_AT_INDEX } },
            },
          })
        ).ok(),
      ).toBe(true);

      // Die Phasenuebergaenge davor werden grob abgetastet (100 ms) -- sie
      // sind Vorbedingungen, keine Messgroesse, und ein 5-ms-Poll ueber die
      // gesamte ~15-s-Anfahrt waere sinnlose Last.
      await waitForNavState(
        page,
        (s) => s.status === 'navigating' && s.route_id === route.id,
        60_000,
        100,
      );

      // Der UI-Horcher wird VOR der Abweichung scharfgestellt -- die
      // Bestaetigung braucht danach noch >= 5 s, das Fenster ist also
      // reichlich. Waere er erst danach installiert, koennte das Ereignis
      // schon durch sein.
      const newRouteInUi = waitForNewRouteInUi(page, route.id, 90_000);
      // DER Messpunkt: das erste `nav/state` mit einer anderen route_id,
      // direkt vom Bus (siehe Kommentar bei `waitForNavState`).
      const newRouteOnBus = bus.waitFor((message) => {
        const state = message.payload as { route_id?: string | null } | null;
        return Boolean(state && state.route_id && state.route_id !== route.id);
      }, 120_000);

      const offRoute = await waitForNavState(page, (s) => s.status === 'off_route', 90_000);
      const rerouted = await newRouteOnBus;

      // Hochaufloesend und monoton, beide Enden im selben Prozess gemessen:
      // die Messgroesse liegt bei ~3 ms, `Date.now()` wuerde sie auf ganze
      // Millisekunden runden und damit ein Drittel Rauschen einbauen.
      const askedAt = valhallaStub.lastCallAtHrMs();
      expect(askedAt, 'der Core hat den Router nie gefragt').not.toBeNull();
      expect(valhallaStub.callCount()).toBe(callsBefore + 1);

      // Endzustand ueber API UND UI (docs/07-Regel): der Core fuehrt eine
      // andere Route, und die neue Anweisung erreicht auch die Oberflaeche.
      const apiAfter = await apiNavState(page);
      expect(apiAfter.route_id).not.toBe(route.id);
      expect(apiAfter.route_id).not.toBeNull();
      await newRouteInUi;

      rerouteSamples.push(rerouted.receivedAtHrMs - (askedAt as number));
      confirmSamples.push(rerouted.receivedAt - offRoute.at);

      await request.post(`${PERF_CORE_BASE_URL}/api/v1/simulator/stop`).catch(() => undefined);
      await request.post(`${PERF_CORE_BASE_URL}/api/v1/navigation/stop`).catch(() => undefined);
    }
  } finally {
    await request.post(`${PERF_CORE_BASE_URL}/api/v1/simulator/stop`).catch(() => undefined);
    await request.post(`${PERF_CORE_BASE_URL}/api/v1/navigation/stop`).catch(() => undefined);
    // Der Simulator nagelt die Positionsquelle prozessweit fest -- ohne
    // Freigabe wuerde die WS-Latenzmessung danach auf eine Position warten,
    // die der Core mit 409 ablehnt (siehe `releasePositionSource`).
    await releasePositionSource(request, PERF_CORE_BASE_URL);
    await context.close();
  }

  recordAndAssert({
    id: 'reroute_ms',
    value: interquartileMean(rerouteSamples),
    samples: rerouteSamples.map((s) => Math.round(s * 100) / 100),
    note:
      `${ITERATIONS} Reroutes, interquartiles Mittel; Median ${median(rerouteSamples).toFixed(2)} ms. ` +
      `Ab erstem Off-Route-Fix (inkl. der ~5 s Entprellung, NICHT Teil des Budgets): ` +
      `${median(confirmSamples).toFixed(0)} ms`,
  });
});
