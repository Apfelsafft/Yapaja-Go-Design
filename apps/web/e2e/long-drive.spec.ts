/**
 * Eine laengere Testfahrt -- und was dabei kaputtgeht.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Und das schlimmste, nach kurzer Zeit verschwindet die gesamte Anzeige und
 * man sieht nur noch einen blanken Screen. Nur die HA Menüs sind noch da, die
 * Yapaja Oberfläche ist weg. Wenn ich auf ein anderes HA Menü wechsle und dann
 * wieder zurück zu Yapaja ist alles wieder da und ich werde gefragt ob ich die
 * Navigation fortsetzen möchte. Bei Bestätigung wird weiter navigiert aber die
 * blaue Streckenlinie fehlt jetzt."
 *
 * ─── WAS DIESE BESCHREIBUNG SCHON VERRAET ───────────────────────────────────
 * Die Oberflaeche ist nicht haengen geblieben, sie wurde ABGERAEUMT: die
 * HA-Menues aussen herum leben weiter, und ein Neuladen heilt alles. Genau das
 * tut React 18, wenn ein Fehler beim Zeichnen nach oben durchschlaegt und ihn
 * niemand auffaengt -- der ganze Baum wird entfernt. Eine Fehlergrenze gibt es
 * in dieser Anwendung nirgends.
 *
 * ─── WARUM DIESER TEST SO LANGE FAEHRT ──────────────────────────────────────
 * „Nach kurzer Zeit" heisst: nicht sofort. Ein Test, der zwei Positionen
 * schickt, saehe nichts. Hier laeuft eine echte Wiedergabe im Zeitraffer ueber
 * viele simulierte Sekunden, und jede Ausnahme im Browser wird eingesammelt.
 */

import { test, expect, type Page } from '@playwright/test';
import { LONG_DRIVE_CORE_BASE_URL, LONG_DRIVE_VALHALLA_PORT } from './support/constants.js';
import { startValhallaStub, type ValhallaStub } from './support/valhallaStub.js';
import { collectPageErrors } from './support/network.js';
import type { LatLon } from '../../core/src/routing/polyline.js';

const BASE_LAT = 47.4;
const BASE_LON = 9.7;
const M_PER_DEG_LAT = 111_195;

/** 60 Punkte, ~111 m auseinander -- lang genug fuer eine laengere Fahrt. */
const POINTS: LatLon[] = Array.from({ length: 60 }, (_, i) => ({
  lat: BASE_LAT + (i * (M_PER_DEG_LAT * 0.001)) / M_PER_DEG_LAT,
  lon: BASE_LON,
}));

let valhallaStub: ValhallaStub;

test.beforeAll(async () => {
  valhallaStub = await startValhallaStub(LONG_DRIVE_VALHALLA_PORT);
});

test.afterAll(async () => {
  await valhallaStub.close();
});

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

async function planeUndFahre(page: Page): Promise<string> {
  await page.request.post(`${LONG_DRIVE_CORE_BASE_URL}/api/v1/position/browser`, {
    data: {
      lat: POINTS[0].lat,
      lon: POINTS[0].lon,
      alt: null,
      speed: 0,
      heading: 0,
      accuracy: 5,
      fix: '3d',
      ts: new Date().toISOString(),
    },
  });

  const profileId = await page.request
    .get(`${LONG_DRIVE_CORE_BASE_URL}/api/v1/profiles`)
    .then(async (r) => {
      const data = ((await r.json()) as { data: Array<{ id: string; is_active?: boolean }> }).data;
      return (data.find((p) => p.is_active) ?? data[0]).id;
    });

  const res = await page.request.post(`${LONG_DRIVE_CORE_BASE_URL}/api/v1/routes`, {
    data: {
      origin: { lat: POINTS[0].lat, lon: POINTS[0].lon },
      destination: { lat: POINTS[59].lat, lon: POINTS[59].lon },
      waypoints: [],
      profile_id: profileId,
      alternatives: 0,
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const route = ((await res.json()) as { data: Array<{ id: string }> }).data[0];

  await page.evaluate((r) => {
    window.__yapajaRoutingStore?.setState({ routes: [r] as never, activeRouteId: (r as { id: string }).id });
  }, route as never);

  const start = await page.request.post(`${LONG_DRIVE_CORE_BASE_URL}/api/v1/navigation/start`, {
    data: { route, destination: { latlng: POINTS[59], name: 'Ziel' } },
  });
  expect(start.ok(), await start.text()).toBe(true);

  return route.id;
}

test.describe('Eine laengere Testfahrt', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    // 59 Abschnitte a ~111,195 m = ~6,56 km. Die angegebene Laenge muss
    // mindestens der Luftlinie entsprechen, sonst lehnt die
    // Plausibilitaetspruefung die Route zu Recht ab (fail closed).
    valhallaStub.setNextTrip({ points: POINTS, lengthKm: 6.6, timeS: 400 });
    valhallaStub.setTraceAttributesEdges([
      { begin_shape_index: 0, end_shape_index: 59, speed_limit: 50 },
    ]);
    await page.request
      .post(`${LONG_DRIVE_CORE_BASE_URL}/api/v1/simulator/stop`)
      .catch(() => {});
    await page.request
      .post(`${LONG_DRIVE_CORE_BASE_URL}/api/v1/navigation/stop`)
      .catch(() => {});
  });

  test('die Oberflaeche ueberlebt sie -- kein blanker Bildschirm', async ({ page }) => {
    test.setTimeout(120_000);
    const pageErrors = collectPageErrors(page);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(LONG_DRIVE_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    const routeId = await planeUndFahre(page);

    // Im Zeitraffer abfahren -- 32x, damit viele simulierte Sekunden in
    // wenige echte passen.
    const play = await page.request.post(`${LONG_DRIVE_CORE_BASE_URL}/api/v1/simulator/play`, {
      data: { track: { routeId }, speed_factor: 32 },
    });
    expect(play.ok(), await play.text()).toBe(true);

    // Eine ganze Weile fahren lassen.
    await expect
      .poll(
        async () =>
          page.request
            .get(`${LONG_DRIVE_CORE_BASE_URL}/api/v1/simulator/status`)
            .then(async (r) => ((await r.json()) as { data: { tickS: number } }).data.tickS),
        { timeout: 60_000, intervals: [1000] },
      )
      .toBeGreaterThan(120);

    // ─── DIE OBERFLAECHE MUSS NOCH DA SEIN ──────────────────────────────────
    // Der blanke Bildschirm ist ein abgeraeumter React-Baum: die Karte selbst
    // waere dann weg, nicht nur unsichtbar.
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
    await expect(page.getByTestId('map-container')).toBeVisible();

    expect(pageErrors, 'keine Ausnahme im Browser waehrend der Fahrt').toEqual([]);
    expect(consoleErrors, 'keine Fehlermeldung in der Konsole').toEqual([]);
  });

  // ─── „Die abgefahrene Strecke bleibt weiterhin blau." ──────────────────────
  // Der letzte offene Punkt der Testfahrt. Geprueft wird hier, was sich nur
  // im echten Browser pruefen laesst: dass MapLibre die beiden Linienstuecke
  // annimmt UND den Farb-Ausdruck darauf akzeptiert. Ein Ausdruck, den
  // MapLibre ablehnt, faellt in Unit-Tests durch jedes Netz -- er wird ja gar
  // nicht ausgewertet.
  //
  // ─── WARUM HIER NICHT DER SIMULATOR FAEHRT ────────────────────────────────
  // Der erste Entwurf liess die Strecke im 32-fachen Zeitraffer abfahren und
  // prueft dann „das Graue ist gewachsen". Beim Gegentest (Aenderung
  // zurueckgedreht) fiel auf, dass die Route dabei laengst ANGEKOMMEN war:
  // 6,5 km bei 50 km/h sind im Zeitraffer knapp 15 Sekunden. Gemessen wurde
  // also eine abgeschlossene Fahrt, nicht eine laufende -- und ob dabei die
  // richtige Stelle grau ist, sagt das nicht.
  //
  // Jetzt werden die Positionen selbst gesetzt. Damit steht nicht nur fest,
  // DASS Graues entsteht, sondern dass es genau bis dorthin reicht, wo das
  // Fahrzeug ist.
  test('die gefahrene Haelfte wird grau, die kommende bleibt blau', async ({ page }) => {
    test.setTimeout(120_000);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(LONG_DRIVE_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await planeUndFahre(page);

    // Vor dem ersten Meter: EIN Stueck, und zwar das blaue.
    await expect.poll(() => teileDerRoute(page), { timeout: 15_000 }).toEqual(['remaining']);

    /** Abstand zweier Stuetzpunkte: 0,001 Grad Breite. */
    const PUNKT_M = 111.19;
    // ─── WARUM IN VIERERSCHRITTEN ───────────────────────────────────────────
    // Der Kartenabgleich sucht nur ±500 m um den letzten Stand (`mapMatching.
    // ts`, SEARCH_WINDOW_M -- die Absicherung gegen Haarnadelkurven). Der
    // erste Entwurf sprang von Punkt 10 auf Punkt 30, also 2,2 km weit;
    // gemessen wurden dann 1667,9 m statt 3335,7 m -- genau die Kante des
    // Suchfensters. Das war richtiges Verhalten und ein falscher Test.
    // Vier Punkte sind 444,8 m und bleiben darin.
    const SCHRITT = 4;

    for (const [von, bis] of [
      [0, 8],
      [8, 20],
    ]) {
      for (let i = von + SCHRITT; i <= bis; i += SCHRITT) await fahreZu(page, i);

      await expect
        .poll(() => teileDerRoute(page), { timeout: 10_000, intervals: [250] })
        .toEqual(['traveled', 'remaining']);

      const { luecke, grauM } = await geometrieDerTeile(page);
      // Ohne Luecke: der Trennpunkt gehoert beiden Stuecken an. Klaffte hier
      // etwas, saehe man genau an der Fahrzeugposition ein Loch in der Route.
      expect(luecke, `Trennpunkt bei Punkt ${bis}`).toBe(0);
      // Und er liegt DORT, wo das Fahrzeug steht -- nicht irgendwo.
      expect(grauM, `graue Laenge bei Punkt ${bis}`).toBeGreaterThan(bis * PUNKT_M - 20);
      expect(grauM, `graue Laenge bei Punkt ${bis}`).toBeLessThan(bis * PUNKT_M + 20);
    }

    // ─── DIE FARBEN ─────────────────────────────────────────────────────────
    // MapLibre wirft beim Hinzufuegen einer Ebene, deren Ausdruck es nicht
    // versteht -- die Ebene gaebe es dann nicht. Dass sie da ist UND einen
    // Ausdruck traegt, ist der Beleg, dass der Ausdruck gilt.
    const farben = await page.evaluate(() => {
      const map = window.__yapajaMapController?.getMap?.();
      if (!map) return null;
      return {
        akzent: map.getPaintProperty('route-main-accent', 'line-color'),
        rand: map.getPaintProperty('route-main-casing', 'line-color'),
      };
    });
    expect(JSON.stringify(farben?.akzent), 'Akzentfarbe haengt an `part`').toContain('part');
    expect(JSON.stringify(farben?.rand), 'Randfarbe haengt an `part`').toContain('part');

    expect(consoleErrors, 'MapLibre hat nichts zu beanstanden').toEqual([]);
  });
});

/** Das Fahrzeug auf `POINTS[index]` setzen -- die Strecke laeuft nach Norden. */
async function fahreZu(page: Page, index: number): Promise<void> {
  const res = await page.request.post(`${LONG_DRIVE_CORE_BASE_URL}/api/v1/position/browser`, {
    data: {
      lat: POINTS[index].lat,
      lon: POINTS[index].lon,
      alt: null,
      speed: 13.9, // ~50 km/h, ueber der Schwelle, ab der die Richtung zaehlt
      heading: 0, // nach Norden, wie die Strecke
      accuracy: 5,
      fix: '3d',
      ts: new Date().toISOString(),
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  // Die Veroeffentlichung des Cores ist auf 1 Hz gedrosselt -- ohne diese
  // Pause verschluckt sie den naechsten Fix (dasselbe Warten wie in
  // `drive.spec.ts#driveTo`).
  await page.waitForTimeout(1100);
}

/** Die `part`-Eigenschaften der aktiven Route, in Zeichenreihenfolge. */
async function teileDerRoute(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const map = window.__yapajaMapController?.getMap?.();
    const source = map?.getSource('route-main-source') as
      | { getData?: () => Promise<unknown> }
      | undefined;
    if (!source?.getData) return [];
    const data = (await source.getData()) as {
      features?: Array<{ properties?: { part?: string } }>;
    };
    return (data.features ?? []).map((f) => f.properties?.part ?? '?');
  });
}

/**
 * Laenge des grauen Stuecks in Metern und der Abstand zwischen seinem letzten
 * und dem ersten Punkt des blauen (muss 0 sein).
 */
async function geometrieDerTeile(page: Page): Promise<{ grauM: number; luecke: number }> {
  return page.evaluate(async () => {
    const map = window.__yapajaMapController?.getMap?.();
    const source = map?.getSource('route-main-source') as
      | { getData?: () => Promise<unknown> }
      | undefined;
    if (!source?.getData) return { grauM: 0, luecke: Number.NaN };
    const data = (await source.getData()) as {
      features?: Array<{
        properties?: { part?: string };
        geometry?: { coordinates?: [number, number][] };
      }>;
    };
    const teil = (name: string): [number, number][] =>
      data.features?.find((f) => f.properties?.part === name)?.geometry?.coordinates ?? [];

    const grau = teil('traveled');
    const blau = teil('remaining');

    // Grobe Meter -- fuer „waechst" und „keine Luecke" reicht eine ebene
    // Naeherung vollkommen aus.
    const M_PRO_GRAD = 111_195;
    let grauM = 0;
    for (let i = 1; i < grau.length; i++) {
      const dLat = (grau[i][1] - grau[i - 1][1]) * M_PRO_GRAD;
      const dLon =
        (grau[i][0] - grau[i - 1][0]) * M_PRO_GRAD * Math.cos((grau[i][1] * Math.PI) / 180);
      grauM += Math.hypot(dLat, dLon);
    }

    let luecke = Number.NaN;
    if (grau.length > 0 && blau.length > 0) {
      const a = grau[grau.length - 1];
      const b = blau[0];
      luecke = Math.hypot(a[0] - b[0], a[1] - b[1]);
    }
    return { grauM, luecke };
  });
}
