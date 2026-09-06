/**
 * Eine laengere Testfahrt -- und was dabei kaputtgeht.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Und das schlimmste, nach kurzer Zeit verschwindet die gesamte Anzeige und
 * man sieht nur noch einen blanken Screen. Nur die HA Menüs sind noch da, die
 * Yapaia Oberfläche ist weg. Wenn ich auf ein anderes HA Menü wechsle und dann
 * wieder zurück zu Yapaia ist alles wieder da und ich werde gefragt ob ich die
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
import { DRIVE_VEHICLE_Y } from '../src/map/drivePadding.js';
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
  await page.waitForFunction(() => Boolean(window.__yapaiaMapController?.getMap?.()), undefined, {
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
    window.__yapaiaRoutingStore?.setState({ routes: [r] as never, activeRouteId: (r as { id: string }).id });
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
      const map = window.__yapaiaMapController?.getMap?.();
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

  // ─── DER BLICK GEHT NACH VORN ─────────────────────────────────────────────
  // „Kurz vor der Abfahrt nach rechts bin ich noch recht weit rausgezoomt. Da
  // waere es besser wenn man genau die Strassen und Abfahrten sieht."
  //
  // Der Auto-Zoom griff dabei bereits -- gemessen: bei 222 m zum Abbiegepunkt
  // stand die Karte auf 16,99. Die Stufe war nur zu weit weg, weil das
  // Fahrzeug in der BILDMITTE sass und die untere Bildhaelfte damit Strecke
  // zeigte, die schon hinter einem lag.
  //
  // Geprueft wird hier die Lage im Bild, denn genau daran haengt die Rechnung
  // in `drivePadding.ts` -- und ob MapLibres `padding` in die erwartete
  // Richtung schiebt, laesst sich nur an einer echten Karte feststellen.
  test('waehrend der Fahrt sitzt das Fahrzeug unten, danach wieder mittig', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(LONG_DRIVE_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    expect(await fahrzeugImBild(page), 'vor der Fahrt: mittig').toBeCloseTo(0.5, 2);

    await planeUndFahre(page);
    await fahreZu(page, 4);

    const waehrend = await fahrzeugImBild(page);
    expect(waehrend, 'waehrend der Fahrt: im unteren Viertel').toBeCloseTo(DRIVE_VEHICLE_Y, 2);
    expect(waehrend, 'und wirklich tiefer als vorher').toBeGreaterThan(0.5);

    await page.request
      .post(`${LONG_DRIVE_CORE_BASE_URL}/api/v1/navigation/stop`)
      .catch(() => {});
    await expect
      .poll(() => fahrzeugImBild(page), { timeout: 15_000, intervals: [250] })
      .toBeCloseTo(0.5, 2);
  });

  // ─── „Der blaue Punkt springt immer von Punkt zu Punkt" ───────────────────
  // Gemessen wurde vorher, wie oft ueberhaupt eine Meldung ankommt: der
  // Simulator schickt eine je simulierter Sekunde, der Core laesst hoechstens
  // 1 Hz durch -- also genau so oft wie ein echter Empfaenger. Die Rate war
  // nicht das Problem, sondern dass zwischen zwei Meldungen NICHTS gezeichnet
  // wurde.
  //
  // Geprueft wird deshalb die Bewegung selbst: liegt der Punkt zwischendurch
  // wirklich ZWISCHEN den beiden Meldungen, und kommt er am Ende an?
  test('der blaue Punkt wandert zur naechsten Meldung, statt zu springen', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(LONG_DRIVE_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    // Zwei Meldungen, damit ein Takt bekannt ist -- die erste kann nicht
    // wandern, weil es kein „vorher" gibt.
    await fahreZu(page, 0);
    await fahreZu(page, 4);

    // Die dritte losschicken und sofort mitschreiben, wo der Punkt steht.
    const vonLat = POINTS[4].lat;
    const nachLat = POINTS[8].lat;
    await page.request.post(`${LONG_DRIVE_CORE_BASE_URL}/api/v1/position/browser`, {
      data: {
        lat: nachLat,
        lon: POINTS[8].lon,
        alt: null,
        speed: 13.9,
        heading: 0,
        accuracy: 5,
        fix: '3d',
        ts: new Date().toISOString(),
      },
    });

    // Zwei Sekunden abtasten -- laenger als die Bewegung selbst, damit auch
    // das Ankommen mit in der Reihe steht.
    const proben = await tasteAb(page, 2000);
    // ─── UNTERWEGS ──────────────────────────────────────────────────────────
    // Echte Zwischenstaende: nicht am Start, nicht am Ziel. Ein Sprung haette
    // hier NUR Ziel-Werte.
    const abstand = nachLat - vonLat;
    const dazwischen = proben.filter(
      (lat) => lat > vonLat + abstand * 0.05 && lat < nachLat - abstand * 0.05,
    );
    expect(
      new Set(dazwischen.map((l) => l.toFixed(7))).size,
      `Zwischenstaende, Proben: ${proben.length}`,
    ).toBeGreaterThan(3);

    // ─── UND ES GEHT NUR VORWAERTS ──────────────────────────────────────────
    for (let i = 1; i < proben.length; i++) {
      expect(proben[i], `Probe ${i} lief rueckwaerts`).toBeGreaterThanOrEqual(proben[i - 1] - 1e-9);
    }

    // ─── ANGEKOMMEN ─────────────────────────────────────────────────────────
    // Glaetten darf nicht heissen, dass der Punkt hinterherhinkt.
    await expect.poll(() => puckLat(page), { timeout: 10_000, intervals: [100] }).toBeCloseTo(
      nachLat,
      6,
    );
  });

  // ─── DER BLANKE BILDSCHIRM, ENDLICH MIT URSACHE ───────────────────────────
  // „Den Zoom konnte ich nicht testen da es gleich gecrasht ist."
  //
  // In den Kurs-Modi dreht Yapaia die Karte dem Fahrzeug nach. Die Abfrage,
  // ob ueberhaupt gedreht werden muss, verglich den GPS-Kurs (0..360) mit dem
  // Kartenwinkel -- und den speichert MapLibre GEWICKELT. Im Browser
  // gemessen: gesetzt 200, gelesen -160. Der alte Vergleich las daraus 360
  // Grad Unterschied und drehte erneut; `setCamera` springt, MapLibre meldet
  // `moveend` SOFORT, der Zuhoerer ruft zurueck -- bis der Aufrufstapel voll
  // war. Genau das ist „Maximum call stack size exceeded."
  //
  // Getroffen hat es jede Fahrt Richtung WESTEN. Dass es hier nie auffiel,
  // hat einen schlichten Grund: alle Testfahrten in dieser Datei fahren nach
  // NORDEN, und Kurs 0 wickelt nicht.
  //
  // ─── WARUM IM BROWSER UND NICHT NUR ALS EINHEITSTEST ──────────────────────
  // Die Rueckkopplung entsteht aus MapLibres Verhalten (Wicklung, sofortiges
  // `moveend`). Eine nachgebaute Karte haette genau das nachgebaut, was
  // falsch verstanden war. `map/angles.test.ts` prueft die Regel; dieser Test
  // prueft, dass sie die richtige ist.
  for (const modus of ['2d-course', '3d-course']) {
    test(`${modus}: keine Himmelsrichtung raeumt die Anzeige ab`, async ({ page }) => {
      test.setTimeout(90_000);
      const pageErrors = collectPageErrors(page);
      const consoleErrors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text());
      });

      // Der Modus liegt im Speicher des Browsers -- genau dort, wo ihn das
      // Umschalten auf dem Geraet hinterlaesst.
      await page.addInitScript((m) => localStorage.setItem('yapaja.viewMode', m), modus);
      await page.goto(LONG_DRIVE_CORE_BASE_URL + '/');
      await waitForMapReady(page);

      // Rundherum. Die ueber 180 sind die, an denen es abgestuerzt ist.
      const KURSE = [0, 45, 90, 135, 180, 200, 225, 270, 315, 359];
      for (const [schritt, kurs] of KURSE.entries()) {
        // Das Fahrzeug bewegt sich dabei -- steht es still, bleibt der
        // Kartenmittelpunkt gleich, MapLibre meldet keine Bewegung, und die
        // Karte dreht gar nicht erst. (Beim ersten Entwurf lagen alle
        // Positionen aufeinander; der Kartenwinkel hinkte dann genau eine
        // Meldung hinterher.)
        await meldeKurs(page, kurs, schritt);

        // Der Absturzbildschirm ist der sichtbare Beweis.
        await expect(page.getByTestId('crash-screen'), `Absturz bei Kurs ${kurs}`).toHaveCount(0);

        // Und die Karte zeigt wirklich dorthin -- der Vergleich waere sonst
        // auch dadurch zu erfuellen, dass gar nicht mehr gedreht wird.
        const gelesen = await page.evaluate(
          () => window.__yapaiaMapController!.getMap!()!.getBearing(),
        );
        const abstand = Math.abs(((kurs - gelesen + 540) % 360) - 180);
        expect(abstand, `Kartenwinkel bei Kurs ${kurs}: ${gelesen}`).toBeLessThan(1);
      }

      await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
      expect(pageErrors, 'keine Ausnahme im Browser').toEqual([]);
      expect(consoleErrors, 'keine Fehlermeldung in der Konsole').toEqual([]);
    });
  }
});

/** Die Breite, auf der der blaue Punkt GERADE gezeichnet ist. */
async function puckLat(page: Page): Promise<number | null> {
  return page.evaluate(() => window.__yapaiaPuckPosition?.lat ?? null);
}

/**
 * Tastet die gezeichnete Stelle IM BROWSER ab und gibt die Reihe zurueck.
 *
 * Von aussen Probe fuer Probe zu holen ging nicht: der erste Entwurf las die
 * Kartenquelle ueber `getData()`, das laeuft ueber den Worker und brauchte
 * gemessen rund 300 ms -- von einer Bewegung ueber gut eine Sekunde blieben
 * so vier Proben uebrig, und der Test hielt eine richtige Glaettung faelsch-
 * licherweise fuer einen Sprung.
 */
async function tasteAb(page: Page, dauerMs: number): Promise<number[]> {
  return page.evaluate((ms) => {
    return new Promise<number[]>((fertig) => {
      const werte: number[] = [];
      const start = performance.now();
      const schritt = (): void => {
        const lat = window.__yapaiaPuckPosition?.lat;
        if (typeof lat === 'number') werte.push(lat);
        if (performance.now() - start < ms) requestAnimationFrame(schritt);
        else fertig(werte);
      };
      schritt();
    });
  }, dauerMs);
}

/** Wo das Fahrzeug im Bild sitzt, als Anteil der Kartenhoehe von oben. */
async function fahrzeugImBild(page: Page): Promise<number> {
  return page.evaluate(() => {
    const map = window.__yapaiaMapController!.getMap!()!;
    return map.project(map.getCenter()).y / map.getCanvas().clientHeight;
  });
}

/** Eine Position mit genau diesem Kurs melden, ein Stueck weiter als die vorige. */
async function meldeKurs(page: Page, heading: number, schritt: number): Promise<void> {
  const res = await page.request.post(`${LONG_DRIVE_CORE_BASE_URL}/api/v1/position/browser`, {
    data: {
      lat: 47.4 + schritt * 0.001,
      lon: 9.7,
      alt: null,
      speed: 13.9,
      heading,
      accuracy: 5,
      fix: '3d',
      ts: new Date().toISOString(),
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  await page.waitForTimeout(1100); // 1-Hz-Drossel des Cores
}

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
    const map = window.__yapaiaMapController?.getMap?.();
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
    const map = window.__yapaiaMapController?.getMap?.();
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
