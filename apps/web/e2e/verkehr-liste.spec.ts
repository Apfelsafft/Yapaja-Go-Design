/**
 * 0.27: Verkehrsmeldungen nur entlang der Route, die nächsten fünf als Text.
 *
 * Gemeldet: „Bitte visualisiere nur Meldungen auf oder entlang der Route …
 * Können wir die Infos in eine Textbox darstellen? Die Top 5 entlang der
 * Route sortiert nach Abstand zur aktuellen Position."
 */

import { test, expect } from '@playwright/test';
import type { Route } from '@yapaia/shared';
import { encodePolyline6, type LatLon } from '../../core/src/routing/polyline.js';
import { CORE_BASE_URL } from './support/constants.js';

test.use({ serviceWorkers: 'block' });

// 20 km nach Norden.
const PUNKTE: LatLon[] = Array.from({ length: 21 }, (_, i) => ({ lat: 49 + i * 0.009, lon: 8.5 }));
const ROUTE = {
  id: 'verkehr-liste-route',
  distance_m: 20000,
  duration_s: 900,
  geometry: encodePolyline6(PUNKTE),
  legs: [{ index: 0, distance_m: 20000, duration_s: 900 }],
  maneuvers: [],
  speed_limits: [],
  warnings: [],
} as unknown as Route;

const meldung = (id: string, km: number, lon = 8.5, art = 'baustelle') => ({
  id,
  art,
  strasse: 'A 5',
  titel: `Meldung ${id}`,
  beschreibung: `Beschreibung ${id}`,
  lat: 49 + km * 0.009,
  lon,
  symbol: art === 'sperrung' ? 'verkehr-sperrung' : 'verkehr-baustelle',
});

test('nur Meldungen an der Route; die nächsten fünf als Liste, die nächste zuerst', async ({ page }) => {
  await page.goto(CORE_BASE_URL + '/');
  await page.waitForFunction(() => Boolean(window.__yapaiaVerkehrStore && window.__yapaiaRoutingStore && window.__yapaiaMapController?.getMap()?.isStyleLoaded()));

  const meldungen = [
    meldung('k12', 12),
    meldung('k3', 3),
    meldung('k8', 8, 8.5, 'sperrung'),
    meldung('k1', 1),
    meldung('k15', 15),
    meldung('k18', 18),
    meldung('k6', 6),
    // 7 km östlich der Route -- betrifft sie nicht.
    meldung('weit', 5, 8.6),
  ];

  await page.evaluate(
    ({ route, m }) => {
      window.__yapaiaRoutingStore!.setState({
        destination: { lat: 49.18, lon: 8.5 },
        // Eine Alternative auf DERSELBEN Linie: der Tipp auf die Marke darf
        // sie nicht auswählen (gemeldet: „die Karte zoomt raus").
        routes: [route as never, { ...(route as object), id: 'alternative' } as never],
        activeRouteId: (route as { id: string }).id,
      });
      window.__yapaiaVerkehrStore!.setState({ meldungen: m } as never);
    },
    { route: ROUTE, m: meldungen },
  );

  const liste = page.getByTestId('verkehr-liste');
  await expect(liste).toBeVisible();
  const eintraege = liste.locator('[data-testid^="verkehr-eintrag-"]');
  await expect(eintraege).toHaveCount(5);
  // Ohne Position zählt der Routenanfang; die nächste zuerst.
  await expect(eintraege.nth(0)).toContainText('Meldung k1');
  await expect(eintraege.nth(1)).toContainText('Meldung k3');
  await expect(eintraege.nth(3)).toContainText('Meldung k8');
  await expect(liste).not.toContainText('Meldung weit');

  // Auf der Karte: die weit entfernte Meldung fehlt.
  const aufKarte = await page.evaluate(async () => {
    const map = window.__yapaiaMapController!.getMap()!;
    const quelle = map.getSource('yapaja-verkehr') as unknown as {
      getData: () => Promise<{ features?: Array<{ properties: { id: string } }> }>;
    };
    const daten = await quelle.getData();
    return (daten?.features ?? []).map((f) => f.properties.id);
  });
  expect(aufKarte).toHaveLength(7);
  expect(aufKarte).not.toContain('weit');

  // Tipp auf die Marke bei km 6: Ortskarte mit der Meldung, Route unverändert.
  const punkt = await page.evaluate(async () => {
    const map = window.__yapaiaMapController!.getMap()!;
    map.jumpTo({ center: [8.5, 49 + 6 * 0.009], zoom: 14 });
    await new Promise((r) => setTimeout(r, 600));
    const p = map.project([8.5, 49 + 6 * 0.009]);
    const r = map.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  });
  await page.mouse.click(punkt.x, punkt.y);
  await expect(page.getByTestId('ort-name')).toHaveText('Meldung k6');
  await expect(page.getByTestId('ort-verkehr')).toContainText('Beschreibung k6');
  expect(await page.evaluate(() => window.__yapaiaRoutingStore!.getState().activeRouteId)).toBe('verkehr-liste-route');

  // Einklappbar.
  await page.getByTestId('verkehr-liste-kopf').click();
  await expect(eintraege).toHaveCount(0);
});
