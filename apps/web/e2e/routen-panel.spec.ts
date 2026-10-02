/**
 * 0.25: Routen-Zustand im Seitenpanel mit Fahrzeugwahl; Profile im ⚙-Menü.
 *
 * Gewünscht: „Wir können unser Camper-Profil in den Einstellungen
 * konfigurieren und dann für die Navigation auswählbar machen aus der Liste
 * der Profile."
 */

import { test, expect, type Page } from '@playwright/test';
import type { Route } from '@yapaia/shared';
import { encodePolyline6, type LatLon } from '../../core/src/routing/polyline.js';
import { CORE_BASE_URL } from './support/constants.js';
import { oeffneEinstellung, schliesseEinstellungen } from './support/einstellungen.js';

test.use({ serviceWorkers: 'block' });

const PUNKTE: LatLon[] = Array.from({ length: 6 }, (_, i) => ({ lat: 47.14 + i * 0.002, lon: 9.52 }));
const ROUTE = {
  id: 'routen-panel-route',
  distance_m: 1200,
  duration_s: 120,
  geometry: encodePolyline6(PUNKTE),
  legs: [{ index: 0, distance_m: 1200, duration_s: 120 }],
  maneuvers: [],
  speed_limits: [],
  warnings: [],
} as unknown as Route;

async function legeProfilAn(page: Page, name: string): Promise<string> {
  const r = await page.request.post(`${CORE_BASE_URL}/api/v1/profiles`, {
    data: {
      name,
      height_m: 3.4,
      width_m: 2.3,
      length_m: 7.5,
      weight_t: 4.2,
      avg_speed_kmh: 80,
      hazmat: false,
      avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
    },
  });
  expect(r.ok()).toBe(true);
  return ((await r.json()) as { data: { id: string } }).data.id;
}

async function aktivesProfil(page: Page): Promise<string | null> {
  const r = await page.request.get(`${CORE_BASE_URL}/api/v1/profiles`);
  const liste = ((await r.json()) as { data: Array<{ id: string; is_active: boolean }> }).data;
  return liste.find((p) => p.is_active)?.id ?? null;
}

test('Fahrzeugwahl im Routen-Panel rechnet die Route mit dem gewählten Profil neu', async ({ page }) => {
  const vorher = await aktivesProfil(page);
  const zweites = await legeProfilAn(page, 'E2E Alkoven 3,4 m');
  try {
    const profilIds: unknown[] = [];
    await page.route('**/api/v1/routes', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      profilIds.push((route.request().postDataJSON() as { profile_id?: string }).profile_id);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [ROUTE] }) });
    });

    await page.goto(CORE_BASE_URL + '/');
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => Boolean(window.__yapaiaRoutingStore && window.__yapaiaProfileStore));
    await expect.poll(() => page.evaluate(() => window.__yapaiaProfileStore!.getState().activeProfile?.id ?? null)).not.toBeNull();

    // Ziel setzen und Route anfragen -- wie es die Suche oder die Ortskarte tut.
    await page.evaluate(() => {
      const r = window.__yapaiaRoutingStore!.getState();
      r.setDestination({ lat: 47.15, lon: 9.52 }, 'Testziel');
      void r.requestRoute({
        origin: 'current',
        profileId: window.__yapaiaProfileStore!.getState().activeProfile?.id,
      });
    });
    const blatt = page.getByTestId('destination-sheet');
    await expect(blatt).toBeVisible();
    await expect.poll(() => profilIds.length).toBeGreaterThan(0);

    // Zustand 4 liegt im Seitenpanel auf der Fahrerseite -- dieselbe Seite
    // wie die Suche, darunter -- und nicht mehr unten in der Mitte.
    const kasten = (await blatt.boundingBox())!;
    const suche = (await page.getByTestId('search-input').boundingBox())!;
    const fenster = page.viewportSize()!;
    const amRand = kasten.x < 40 || kasten.x + kasten.width > fenster.width - 40;
    expect(amRand).toBe(true);
    expect(Math.abs(kasten.x + kasten.width / 2 - (suche.x + suche.width / 2))).toBeLessThan(120);
    expect(kasten.width).toBeLessThanOrEqual(380);
    expect(kasten.y).toBeGreaterThan(suche.y + suche.height);

    // Anderes Fahrzeug wählen -> aktiviert und neu gerechnet.
    const wahl = page.getByTestId('routing-profil-wahl');
    await wahl.selectOption(zweites);
    await expect.poll(() => profilIds.at(-1)).toBe(zweites);
    await expect.poll(() => aktivesProfil(page)).toBe(zweites);

    // Verwaltet wird im ⚙-Menü unter „Fahrzeuge"; dort ist es als aktiv markiert.
    await oeffneEinstellung(page, 'profile-chip');
    await expect(page.getByTestId(`profile-item-${zweites}`)).toContainText('Aktiv');
    await schliesseEinstellungen(page);
  } finally {
    if (vorher) await page.request.put(`${CORE_BASE_URL}/api/v1/profiles/${vorher}/activate`);
    await page.request.delete(`${CORE_BASE_URL}/api/v1/profiles/${zweites}`);
  }
});
