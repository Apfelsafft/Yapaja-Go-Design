/**
 * Kein Bedienelement darf ein anderes verdecken.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Wir haben viele Knöpfe und Anzeigen auf der Karte, die sich teilweise
 * überlappen. Bspw. wenn die Navigation aktiv ist, liegen die neuen Buttons
 * über der Zentrierung. Die nächste Abbiegung über der Suchzeile. Oder aber
 * auch die Karteneinstellung über den Zoom-Einstellungen der Karte."
 *
 * ─── WARUM DIESER TEST MISST STATT ZU RECHNEN ───────────────────────────────
 * Die Ursache ist systemisch: JEDES Overlay setzt seine Position selbst, mit
 * handgewaehlten Werten (`bottom-20`, `bottom-24`, `bottom-[120px]`,
 * `bottom-36` ...). Niemand kennt die Nachbarn. `DriveOverlay.tsx` begruendet
 * seinen Abstand ausdruecklich -- aber nur gegenueber `DriveControls`; die
 * drei Karten-Knoepfe auf derselben Seite kommen darin gar nicht vor.
 *
 * Ein Unit-Test mit nachgebauten Hoehen wuerde denselben Fehler wiederholen:
 * er pruefte meine Annahme ueber die Groessen, nicht die Groessen. Deshalb
 * misst dieser Test die ECHTEN Kaesten im Browser (`boundingBox`) und
 * vergleicht sie paarweise. Er kann nicht von der CSS abdriften, weil er die
 * CSS ausliest.
 *
 * Geprueft werden beide Zustaende, denn der Betreiber hat beide gemeldet:
 * ohne Navigation und waehrend einer laufenden Fahrt.
 */

import { test, expect, type Page } from '@playwright/test';
import type { Route } from '@yapaja/shared';
import { encodePolyline6, type LatLon } from '../../core/src/routing/polyline.js';
import { CONTROL_OVERLAP_CORE_BASE_URL } from './support/constants.js';

const BASE_LAT = 47.2;
const BASE_LON = 9.6;
const M_PER_DEG_LAT = 111_195;

const ROUTE_POINTS: LatLon[] = Array.from({ length: 11 }, (_, i) => ({
  lat: BASE_LAT + (i * (M_PER_DEG_LAT * 0.001)) / M_PER_DEG_LAT,
  lon: BASE_LON,
}));
const TOTAL_LENGTH_M = 10 * (M_PER_DEG_LAT * 0.001);

const ROUTE: Route = {
  id: 'overlap-e2e-route',
  distance_m: TOTAL_LENGTH_M,
  duration_s: 120,
  geometry: encodePolyline6(ROUTE_POINTS),
  legs: [{ index: 0, distance_m: TOTAL_LENGTH_M, duration_s: 120 }],
  maneuvers: [
    {
      index: 0,
      type: 'continue',
      instruction: 'Der Hauptstraße folgen',
      street_names: ['Hauptstraße'],
      distance_m: 5 * (M_PER_DEG_LAT * 0.001),
      begin_shape_index: 0,
    },
    {
      index: 1,
      type: 'turn_left',
      instruction: 'Links abbiegen auf die Seestraße',
      street_names: ['Seestraße'],
      distance_m: 5 * (M_PER_DEG_LAT * 0.001),
      begin_shape_index: 5,
    },
  ],
  // Ein Tempolimit ab der Mitte -- damit das Schild sichtbar wird und der
  // Test seine Lage mitmisst.
  speed_limits: [{ begin_shape_index: 0, end_shape_index: 10, kmh: 80 }],
  warnings: [],
};

/** Eine Position auf der Route, damit die Fahrt-Anzeigen erscheinen. */
function browserFixBody(index: number): Record<string, unknown> {
  return {
    lat: ROUTE_POINTS[index].lat,
    lon: ROUTE_POINTS[index].lon,
    alt: null,
    speed: 0,
    heading: 0,
    accuracy: 5,
    fix: '3d',
    ts: new Date().toISOString(),
  };
}

/**
 * Alle Bedienelemente, die gleichzeitig auf der Karte liegen koennen.
 *
 * Bewusst NUR Dinge, die man antippt oder ablesen muss. Vollbild-Dialoge
 * (Assistent, Masse-Rueckfrage) stehen nicht drin -- die duerfen alles
 * verdecken, das ist ihr Zweck.
 */
const CONTROLS = [
  // NICHT `top-bar`: das ist ein durchsichtiger Container ueber die volle
  // Breite mit `pointer-events-none`. Er ueberlappt zwangslaeufig alles und
  // blockiert nichts -- gemessen werden seine BEDIENBAREN Kinder.
  'profile-chip',
  'search-input',
  'compass-button',
  'viewmode-button',
  'recenter-button',
  'style-panel-toggle',
  'regions-panel-toggle',
  'store-panel-toggle',
  'preflight-panel-toggle',
  'simulator-panel-toggle',
  'speed-display',
  // Nur waehrend der Fahrt vorhanden:
  'maneuver-panel',
  'tts-toggle',
  'drive-controls',
  'speed-limit-sign',
  'trip-info-panel',
] as const;

interface Rect {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function visibleControlRects(page: Page): Promise<Rect[]> {
  const rects: Rect[] = [];
  for (const name of CONTROLS) {
    const locator = page.getByTestId(name);
    if ((await locator.count()) === 0) continue;
    if (!(await locator.first().isVisible())) continue;
    const box = await locator.first().boundingBox();
    if (box) rects.push({ name, ...box });
  }
  return rects;
}

/** Die Kanten von MapLibres eigener Zoom-/Kompass-Gruppe. Sie gehoert nicht
 *  uns, liegt aber auf derselben Karte -- und der Betreiber hat sie
 *  ausdruecklich genannt („Karteneinstellung über den Zoom-Einstellungen"). */
async function maplibreControlRect(page: Page): Promise<Rect | null> {
  const locator = page.locator('.maplibregl-ctrl-top-right .maplibregl-ctrl-group').first();
  if ((await locator.count()) === 0) return null;
  if (!(await locator.isVisible())) return null;
  const box = await locator.boundingBox();
  return box ? { name: 'maplibre-zoom-controls', ...box } : null;
}

/** Überlappungsflaeche zweier Rechtecke in Quadratpunkten (0 = beruehrt sich hoechstens). */
function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function findOverlaps(rects: Rect[]): string[] {
  const problems: string[] = [];
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const area = overlapArea(rects[i], rects[j]);
      if (area > 0) {
        problems.push(
          `${rects[i].name} <-> ${rects[j].name}: ${Math.round(area)} qpx ` +
            `(${rects[i].name} @ ${Math.round(rects[i].x)},${Math.round(rects[i].y)} ` +
            `${Math.round(rects[i].width)}x${Math.round(rects[i].height)}; ` +
            `${rects[j].name} @ ${Math.round(rects[j].x)},${Math.round(rects[j].y)} ` +
            `${Math.round(rects[j].width)}x${Math.round(rects[j].height)})`,
        );
      }
    }
  }
  return problems;
}

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

/**
 * Alles herstellen, was die Knoepfe ueberhaupt erscheinen laesst:
 *
 *  * `ReCenterButton` braucht eine Position im Store;
 *  * `CompassButton` erscheint nur bei GEDREHTER Karte.
 *
 * Ohne die Drehung wuerde der Test die Ueberlappung Kompass<->Zentrierung
 * nie sehen -- und genau die gehoert zu den gemeldeten.
 */
/**
 * Position setzen und warten, bis die positionsabhaengigen Knoepfe da sind.
 *
 * Der Speicher wird DIREKT gesetzt statt ueber die Browser-Geolocation: die
 * lieferte im schmalen Fenster verlaesslich gar nichts (`position: null`
 * nach 5 s), und dieser Test prueft GEOMETRIE, nicht die Positionskette.
 * Dasselbe Mittel benutzt `drive.spec.ts` fuer den Routing-Speicher.
 *
 * Der KOMPASS fehlt bewusst: er erscheint nur bei gedrehter Karte, und der
 * Ansichtsmodus `2d-north` sperrt die Drehung auf 0 -- im Test also nicht
 * verlaesslich hervorzulocken. Seine Nachbarschaft deckt der Unit-Test ueber
 * `mapControlLayout.ts` ab, der dieselben Werte benutzt wie die Komponenten.
 */
async function seedPosition(page: Page): Promise<void> {
  await page.evaluate(
    ({ lat, lon }) => {
      window.__yapajaPositionStore?.getState().setPosition({
        lat,
        lon,
        alt: null,
        speed: 0,
        heading: null,
        accuracy: 5,
        source: 'browser',
        fix: '3d',
        ts: new Date().toISOString(),
      });
    },
    { lat: BASE_LAT, lon: BASE_LON },
  );
  await expect(page.getByTestId('recenter-button')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('viewmode-button')).toBeVisible({ timeout: 10_000 });
}

/**
 * Zwei Fenstergroessen, weil Ueberlappungen von der Breite abhaengen.
 *
 * Das breite Fenster ist Playwrights Standard. Das schmale bildet ein Tablet
 * im Hochformat nach -- so, wie der Betreiber es benutzt. Genau dort schob
 * sich die Abbiege-Anzeige (mittig) ueber die Suchzeile; im breiten Fenster
 * ebenfalls, aber mit anderer Flaeche -- beide Faelle sind gemessen.
 */
const VIEWPORTS = [
  { name: 'breit', size: { width: 1280, height: 720 } },
  { name: 'Tablet hochkant', size: { width: 768, height: 1024 } },
] as const;

test.describe('Bedienelemente ueberlappen einander nicht', () => {
  test.describe.configure({ mode: 'default' });



  test.afterEach(async ({ page }) => {
    await page
      .evaluate(async (baseUrl: string) => {
        await fetch(`${baseUrl}/api/v1/navigation/stop`, { method: 'POST' });
      }, CONTROL_OVERLAP_CORE_BASE_URL)
      .catch(() => {
        /* best effort */
      });
  });

  for (const viewport of VIEWPORTS) {
  test(`ohne laufende Navigation (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize(viewport.size);
    await page.goto(CONTROL_OVERLAP_CORE_BASE_URL + '/');
    await waitForMapReady(page);
    await seedPosition(page);

    const rects = await visibleControlRects(page);
    const mapCtrl = await maplibreControlRect(page);
    if (mapCtrl) rects.push(mapCtrl);

    // Mindestens die Karten-Knoepfe muessen da sein -- sonst prueft der Test
    // eine leere Liste und ist immer gruen.
    expect(rects.map((r) => r.name)).toEqual(
      expect.arrayContaining(['viewmode-button', 'recenter-button', 'search-input']),
    );

    expect(findOverlaps(rects), findOverlaps(rects).join('\n')).toEqual([]);
  });

  test(`waehrend einer laufenden Fahrt (${viewport.name})`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport.size);
    await page.goto(CONTROL_OVERLAP_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    const startResponse = await page.request.post(`${CONTROL_OVERLAP_CORE_BASE_URL}/api/v1/navigation/start`, {
      data: { route: ROUTE, destination: { latlng: ROUTE_POINTS[10], name: 'Ziel' } },
    });
    expect(startResponse.ok(), await startResponse.text()).toBe(true);

    await page.evaluate((route: Route) => {
      window.__yapajaRoutingStore?.setState({ routes: [route], activeRouteId: route.id });
    }, ROUTE);

    await page.request.post(`${CONTROL_OVERLAP_CORE_BASE_URL}/api/v1/position/browser`, {
      data: browserFixBody(1),
    });
    await expect(page.getByTestId('maneuver-panel')).toBeVisible({ timeout: 10_000 });

    const rects = await visibleControlRects(page);
    const mapCtrl = await maplibreControlRect(page);
    if (mapCtrl) rects.push(mapCtrl);

    // Die Fahrt-Bedienelemente muessen wirklich da sein.
    expect(rects.map((r) => r.name)).toEqual(
      expect.arrayContaining(['maneuver-panel', 'drive-controls']),
    );

    expect(findOverlaps(rects), findOverlaps(rects).join('\n')).toEqual([]);
  });
  }
});
