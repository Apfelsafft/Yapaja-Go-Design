/**
 * Erzeugt die Bilder und Filme für die Dokumentation.
 *
 * ─── WARUM DAS EIN EIGENER LAUF IST ─────────────────────────────────────────
 * Das hier prüft nichts. Es nimmt auf. Deshalb liegt es NICHT unter `e2e/`
 * (wo Playwright per Vorgabe alles einsammelt) und läuft nicht in der CI mit:
 * ein Aufnahmelauf, der bei jedem Pull Request Bilder neu schreibt, erzeugt
 * nur Binärrauschen im Verlauf. Aufgerufen wird er von Hand, wenn sich die
 * Oberfläche sichtbar geändert hat:
 *
 *     pnpm --filter @yapaia/web exec playwright test -c docs-media.config.ts
 *
 * ─── WAS AUF DEN BILDERN FEHLT, UND WARUM ───────────────────────────────────
 * Der Kartenhintergrund bleibt leer. Der Testaufbau hat keine echten
 * Kartendaten: `apps/core/src/map/__fixtures__/pmtiles-fixture.ts` erzeugt
 * bewusst nur einen gültigen PMTiles-KOPF ohne Kacheln, weil kein Test je
 * gezeichnete Straßen braucht. Nachgemessen: der Kartencanvas hat genau eine
 * Farbe (245,243,236).
 *
 * Daraus folgt die Bildsprache hier: wo die Karte NICHT der Punkt ist, wird
 * das Bedienelement einzeln aufgenommen (`element.screenshot()`) statt der
 * ganzen Seite. Ein Handbuchbild soll die Schaltfläche zeigen, nicht 900
 * Pixel leere Fläche daneben.
 *
 * Die Route und die eigene Position zeichnet Yapaia selbst (GeoJSON, keine
 * Kacheln) — die sind auf den Fahrbildern deshalb echt zu sehen.
 */

import { test, expect, type Page } from '@playwright/test';
import type { Route } from '@yapaia/shared';
import { encodePolyline6, type LatLon } from '../../core/src/routing/polyline.js';
import { DRIVE_CORE_BASE_URL, CORE_BASE_URL } from '../e2e/support/constants.js';

const AUSGABE = '../../docs/media';

// INNERHALB der Fixture-Grenzen (minLat 47.2 / minLon 5.8 -- siehe
// pmtiles-fixture.ts). Liegt die Position ausserhalb, blendet Yapaia zu Recht
// „Für Ihre Position gibt es keine Karte" quer ins Bild -- richtig fuer den
// Betrieb, unbrauchbar fuer ein Handbuchbild.
const BASIS_LAT = 48.13;
const BASIS_LON = 11.57;
const M_PRO_GRAD = 111_195;

/** Eine Route mit Knick -- eine schnurgerade Linie sieht auf einem Bild nach nichts aus. */
const PUNKTE: LatLon[] = [
  { lat: BASIS_LAT, lon: BASIS_LON },
  { lat: BASIS_LAT + 0.0035, lon: BASIS_LON + 0.0004 },
  { lat: BASIS_LAT + 0.0065, lon: BASIS_LON + 0.0022 },
  { lat: BASIS_LAT + 0.009, lon: BASIS_LON + 0.0055 },
  { lat: BASIS_LAT + 0.0105, lon: BASIS_LON + 0.0095 },
  { lat: BASIS_LAT + 0.0135, lon: BASIS_LON + 0.0125 },
  { lat: BASIS_LAT + 0.017, lon: BASIS_LON + 0.0135 },
];
const GESAMT_M = 0.017 * M_PRO_GRAD;

const ROUTE: Route = {
  id: 'docs-media-route',
  distance_m: GESAMT_M,
  duration_s: 900,
  geometry: encodePolyline6(PUNKTE),
  legs: [{ index: 0, distance_m: GESAMT_M, duration_s: 900 }],
  maneuvers: [
    {
      index: 0,
      type: 'continue',
      instruction: 'Der Rheinstraße folgen',
      street_names: ['Rheinstraße'],
      distance_m: 0.0065 * M_PRO_GRAD,
      begin_shape_index: 0,
    },
    {
      index: 1,
      type: 'turn_right',
      instruction: 'Rechts abbiegen auf die Bergstraße',
      street_names: ['Bergstraße'],
      distance_m: 0.0045 * M_PRO_GRAD,
      begin_shape_index: 2,
    },
    {
      index: 2,
      type: 'turn_left',
      instruction: 'Links abbiegen auf den Talweg',
      street_names: ['Talweg'],
      distance_m: 0.006 * M_PRO_GRAD,
      begin_shape_index: 4,
    },
  ],
  speed_limits: [{ begin_shape_index: 0, end_shape_index: 6, kmh: 80 }],
  warnings: [],
};

function fix(fortschritt: number, tempoMs: number): Record<string, unknown> {
  const t = Math.min(0.999, Math.max(0, fortschritt));
  const i = Math.floor(t * (PUNKTE.length - 1));
  const rest = t * (PUNKTE.length - 1) - i;
  const a = PUNKTE[i];
  const b = PUNKTE[Math.min(i + 1, PUNKTE.length - 1)];
  return {
    lat: a.lat + (b.lat - a.lat) * rest,
    lon: a.lon + (b.lon - a.lon) * rest,
    alt: 455,
    speed: tempoMs,
    heading: 25,
    accuracy: 5,
    fix: '3d',
    ts: new Date().toISOString(),
  };
}

async function karteBereit(page: Page): Promise<void> {
  await page.locator('canvas.maplibregl-canvas').waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => Boolean(window.__yapaiaMapController?.getMap?.()), undefined, {
    timeout: 20_000,
  });
  await page.waitForTimeout(1200);
}

/** Nimmt ein einzelnes Bedienelement auf, mit etwas Luft drumherum. */
async function elementBild(page: Page, testid: string, datei: string): Promise<void> {
  const el = page.getByTestId(testid);
  await expect(el).toBeVisible({ timeout: 10_000 });
  await el.screenshot({ path: `${AUSGABE}/${datei}.png` });
}

test.describe.configure({ mode: 'serial' });

test('Bilder der Bedienoberfläche', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 }); // == recordVideo-Groesse
  await page.goto(CORE_BASE_URL + '/');
  await karteBereit(page);

  // Die Schaltzentrale im Ueberblick -- hier ist die (leere) Karte Teil der
  // Aussage: so sieht die App VOR der ersten Region aus.
  await page.screenshot({ path: `${AUSGABE}/explore.png` });

  // Fahrzeugprofil -- der wichtigste Bildschirm ueberhaupt.
  await page.getByTestId('profile-chip').click();
  await page.waitForTimeout(800);
  await elementBild(page, 'profiles-panel', 'fahrzeugprofil');
  await page.getByTestId('profile-chip').click();
  await page.waitForTimeout(500);

  // Favoriten & Verlauf.
  await page.getByTestId('favorites-drawer-toggle').click();
  await page.waitForTimeout(700);
  await elementBild(page, 'favorites-drawer', 'favoriten');
  await page.getByTestId('favorites-drawer-toggle').click();
  await page.waitForTimeout(500);

  // Installationspruefung. Zeigt hier echte Fehlschlaege, weil im Testaufbau
  // weder Valhalla noch Photon laufen -- genau deshalb ist es ein gutes Bild:
  // es zeigt, was die Pruefung im Ernstfall sagt.
  await page.getByTestId('preflight-panel-toggle').click();
  await page.waitForTimeout(3000);
  await elementBild(page, 'preflight-panel', 'installationspruefung');
});

test('Fahrmodus: Bilder und Film', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 800 }); // == recordVideo-Groesse
  await page.goto(DRIVE_CORE_BASE_URL + '/');
  await karteBereit(page);

  // Die Schublade zu, sonst ueberlagert sie die Fahrtdaten unten.
  const schublade = page.getByTestId('favorites-drawer-toggle');
  if (await schublade.isVisible().catch(() => false)) {
    const offen = await page
      .getByTestId('favorites-panel')
      .isVisible()
      .catch(() => false);
    if (offen) await schublade.click();
  }

  await page.request.post(`${DRIVE_CORE_BASE_URL}/api/v1/navigation/start`, {
    data: { route: ROUTE, destination: { latlng: PUNKTE[PUNKTE.length - 1], name: 'Malbun' } },
  });

  const schritte = 26;
  for (let i = 0; i <= schritte; i += 1) {
    await page.request.post(`${DRIVE_CORE_BASE_URL}/api/v1/position/browser`, {
      data: fix(i / schritte, 16),
    });
    await page.waitForTimeout(1100);
    if (i === 7) {
      await page.screenshot({ path: `${AUSGABE}/fahrmodus.png` });
      await elementBild(page, 'maneuver-panel', 'anweisung');
    }
  }

  await page.request.post(`${DRIVE_CORE_BASE_URL}/api/v1/navigation/stop`);
});
