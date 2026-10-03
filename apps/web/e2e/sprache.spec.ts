/**
 * 0.29: Sprachbefehle -- 🎤 in der Kopfzeile, Fenster mit Eingabe, Antwort
 * vom Kern, Aktionen in der Oberfläche.
 *
 * Gewünscht: „Bitte fahre mich zur Ziolkowskistraße nach Magdeburg", „Wo ist
 * die nächste Tankstelle?", „Stoppe Navigation", „Lies mir die nächste
 * Verkehrsinfo auf der Route vor".
 *
 * Getippt statt gesprochen: Chromium im Test hat kein Mikrofon. Die
 * Erkennung selbst ist Sache des Browsers; geprüft wird alles danach.
 */

import { test, expect, type Page } from '@playwright/test';
import type { Route } from '@yapaia/shared';
import { encodePolyline6, type LatLon } from '../../core/src/routing/polyline.js';
import { CORE_BASE_URL } from './support/constants.js';

test.use({ serviceWorkers: 'block' });

async function oeffne(page: Page): Promise<void> {
  await page.goto(CORE_BASE_URL + '/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('sprach-knopf').click();
  await expect(page.getByTestId('sprach-fenster')).toBeVisible();
}

async function sage(page: Page, text: string): Promise<void> {
  await page.getByTestId('sprach-eingabe').fill(text);
  await page.getByTestId('sprach-eingabe').press('Enter');
}

test('der echte Kern antwortet: Stopp ohne Navigation, Hilfe, Unverstandenes', async ({ page }) => {
  await oeffne(page);
  await sage(page, 'Yapaia, stoppe die Navigation');
  await expect(page.getByTestId('sprach-antwort').last()).toHaveText('Es läuft gerade keine Navigation.');

  await sage(page, 'wie wird das Wetter');
  await expect(page.getByTestId('sprach-antwort').last()).toContainText('nicht verstanden');

  await sage(page, 'Ansagen aus');
  await expect(page.getByTestId('sprach-antwort').last()).toHaveText('Ansagen sind aus.');
  expect(await page.evaluate(() => window.__yapaiaTtsStore?.getState().enabled)).toBe(false);
  await sage(page, 'Ansagen an');
  await expect(page.getByTestId('sprach-antwort').last()).toHaveText('Ansagen sind an.');
});

test('Zielvorschlag: Route erscheint auf der Karte, „Ja" startet', async ({ page }) => {
  const PUNKTE: LatLon[] = Array.from({ length: 6 }, (_, i) => ({ lat: 47.14 + i * 0.002, lon: 9.52 }));
  const route = {
    id: 'sprach-route',
    distance_m: 1200,
    duration_s: 180,
    geometry: encodePolyline6(PUNKTE),
    legs: [{ index: 0, distance_m: 1200, duration_s: 180 }],
    maneuvers: [],
    speed_limits: [],
    warnings: [],
  } as unknown as Route;
  const gesendet: string[] = [];
  await page.route('**/api/v1/sprache', async (r) => {
    const text = (r.request().postDataJSON() as { text: string }).text;
    gesendet.push(text);
    const data =
      text === 'ja'
        ? { antwort: "Los geht's nach Städtle.", absicht: 'ja', aktion: { art: 'navigation_gestartet' } }
        : {
            antwort: 'Städtle, Vaduz: 1,2 Kilometer, etwa 3 Minuten. Soll ich losfahren?',
            absicht: 'ziel',
            rueckfrage: true,
            aktion: {
              art: 'route_vorschlag',
              route,
              ziel: { name: 'Städtle', beschreibung: 'Städtle, Vaduz', lat: 47.15, lon: 9.52 },
            },
          };
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  });

  await oeffne(page);
  await sage(page, 'Bitte fahre mich zum Städtle nach Vaduz');
  await expect(page.getByTestId('sprach-antwort').last()).toContainText('Soll ich losfahren?');
  // Die Route liegt auf der Karte, das Routenfenster zeigt das Ziel.
  await expect(page.getByTestId('destination-title')).toHaveText('Städtle, Vaduz');
  expect(await page.evaluate(() => window.__yapaiaRoutingStore!.getState().activeRouteId)).toBe('sprach-route');

  await page.getByTestId('sprach-ja').click();
  await expect(page.getByTestId('sprach-antwort').last()).toHaveText("Los geht's nach Städtle.");
  expect(gesendet).toEqual(['Bitte fahre mich zum Städtle nach Vaduz', 'ja']);
});

test('Auswahl: Treffer als Liste, ein Tipp wählt', async ({ page }) => {
  await page.route('**/api/v1/sprache', async (r) => {
    const text = (r.request().postDataJSON() as { text: string }).text;
    const data = text.startsWith('nummer')
      ? { antwort: `Gewählt: ${text}`, absicht: 'wahl' }
      : {
          antwort: 'Nächste Tankstelle: Aral, in 2,3 Kilometer. Soll ich dich hinführen?',
          absicht: 'naechste',
          rueckfrage: true,
          aktion: {
            art: 'auswahl',
            treffer: [
              { name: 'Aral', beschreibung: 'Aral', lat: 47.1, lon: 9.5, entfernung_m: 2300 },
              { name: 'Shell', beschreibung: 'Shell', lat: 47.2, lon: 9.5, entfernung_m: 5100 },
            ],
          },
        };
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  });
  await oeffne(page);
  await sage(page, 'wo ist die nächste Tankstelle');
  const liste = page.getByTestId('sprach-auswahl');
  await expect(liste).toContainText('Shell');
  await expect(liste).toContainText('5,1 km');
  await liste.getByRole('button', { name: /Shell/ }).click();
  await expect(page.getByTestId('sprach-antwort').last()).toHaveText('Gewählt: nummer 2');
});

test('0.30: ⚙ → Sprache & Home Assistant -- ohne Add-on sagt die Seite das; mit Kern-Antwort zeigt sie den Stand', async ({
  page,
}) => {
  await page.goto(CORE_BASE_URL + '/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('einstellungen-toggle').click();
  await page.getByTestId('sprache-einstellungen-toggle').click();
  // Der Test-Kern läuft nicht als Add-on.
  await expect(page.getByTestId('sprach-ha-nicht-verfuegbar')).toBeVisible();
  await expect(page.getByTestId('sprach-ha-einrichten')).toBeDisabled();

  // Mit Add-on (vorgegebene Antwort): Stand, Einrichten, KI-Auswahl.
  await page.route('**/api/v1/sprache/ha', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          verfuegbar: true,
          helfer: true,
          automation: false,
          agent: null,
          agenten: [{ id: 'conversation.openai', name: 'OpenAI' }],
          ansagenBeat: true,
          radio: true,
        },
      }),
    }),
  );
  await page.route('**/api/v1/sprache/ha/einrichten', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { helfer: true, automation: true } }) }),
  );
  const patches: unknown[] = [];
  await page.route('**/api/v1/settings', async (r) => {
    if (r.request().method() === 'PATCH') patches.push(r.request().postDataJSON());
    await r.fallback();
  });
  await page.getByTestId('einstellungen-zurueck').click();
  await page.getByTestId('sprache-einstellungen-toggle').click();
  await expect(page.getByTestId('sprach-ha-stand')).toContainText('Automation');
  await page.getByTestId('sprach-ha-einrichten').click();
  await expect(page.getByTestId('sprach-ha-ergebnis')).toContainText('Eingerichtet');
  await page.getByTestId('sprach-agent').selectOption('conversation.openai');
  await expect.poll(() => patches).toContainEqual({ sprache_agent: 'conversation.openai' });

  // 0.32: Ansagen ins Radio einmischen -- an ist die Vorgabe.
  await expect(page.getByTestId('sprach-ansagen-beat')).toBeChecked();
  await page.getByTestId('sprach-ansagen-beat').uncheck();
  await expect.poll(() => patches).toContainEqual({ ansagen_beat: false });

  // 0.33: „Ansage ins Radio testen" zeigt den Grund in Klartext (Test-Kern: kein Add-on).
  await page.getByTestId('sprach-ansage-test').click();
  await expect(page.getByTestId('sprach-ansage-test-ergebnis')).toContainText(/Home Assistant|Add-on/);
});
