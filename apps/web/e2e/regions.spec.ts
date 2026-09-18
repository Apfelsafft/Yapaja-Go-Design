/**
 * E01-T5 web acceptance criteria (regions manager UI):
 *
 * The full resumable-download flow (abort/resume, sha256, disk-full) is
 * already covered end-to-end by core integration tests
 * (apps/core/src/map/regions/routes.test.ts, disk-check.routes.test.ts)
 * against a local mock HTTP server -- per the task spec's explicit choice,
 * this Playwright suite instead exercises the parts a browser adds on top:
 * the panel opening, installed regions + the downloadable-regions catalog
 * both rendering from the real (built) core, deleting the only installed
 * region being refused with a plain-language 409 message, and that opening/
 * using the panel never issues a request to a foreign host (reusing the
 * same offline-network harness as the other E01 specs).
 *
 * Both e2e cores serve the bundled default regions-catalog.json (no
 * override configured in globalSetup) -- its entries never match either
 * core's installed region ("fixture"), so they always render as
 * not-installed, which is exactly what's needed to exercise the catalog
 * list rendering here.
 *
 * ─── GEÄNDERT IN `feat/gui-install-path` ────────────────────────────────
 * Diese Spec behauptete vorher, jeder Katalogeintrag habe „a working
 * download button". Der Knopf war da, aber er funktionierte NICHT: die
 * Katalogeinträge nannten Geofabrik-`.pmtiles`-URLs, die es nie gab (404).
 * Die Spec hat das nie gemerkt, weil sie den Download nie ausgelöst hat --
 * sie hat die ANWESENHEIT eines Knopfes geprüft und daraus auf seine
 * Funktion geschlossen.
 *
 * Jetzt gilt: die mitgelieferten Regionen werden GEBAUT, nicht geladen.
 *
 * ─── UMGEBAUT IN 0.16.0 ─────────────────────────────────────────────────
 * Es gibt nur noch EINE Liste (`karte-<id>`) und je Karte höchstens zwei
 * Knöpfe: „Installieren"/„Update" (`installieren-button-<id>`) und
 * „Löschen". Ob dahinter ein Download oder ein Kachelbau steckt, entscheidet
 * die Quelle und ist für den Bedienenden dieselbe Handlung — das war der
 * Punkt der Änderung.
 *
 * Damit prüft diese Spec nicht mehr „welcher Knopf", sondern „ist der Weg
 * da": ein Eintrag ohne jede Quelle bekommt KEINEN Knopf (er könnte nur
 * scheitern), einer mit Quelle schon. Das ist dieselbe Aussage wie vorher,
 * nur ohne die Verpackung.
 */

import { test, expect } from '@playwright/test';
import { CORE_BASE_URL, EMPTY_CORE_BASE_URL, FIXTURE_REGION } from './support/constants.js';
import { trackRequests, collectPageErrors } from './support/network.js';

test('regions panel shows the installed region and refuses to delete the last one (409)', async ({
  page,
}) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);
  const pageErrors = collectPageErrors(page);

  await page.goto(CORE_BASE_URL + '/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('regions-panel-toggle').click();
  await expect(page.getByTestId('regions-panel')).toBeVisible();

  const installedEntry = page.getByTestId(`karte-${FIXTURE_REGION}`);
  await expect(installedEntry).toBeVisible();
  await expect(installedEntry).toContainText(FIXTURE_REGION);

  // Die Fixture-Karte steht in keinem Katalog — sie ist eine von Hand
  // abgelegte `.pmtiles`. Genau dieser Zustand hatte bis 0.15.3 keinen
  // eigenen Namen und wurde vom Gesamtbau stumm übersprungen.
  await expect(installedEntry).toHaveAttribute('data-zustand', 'fremd');
  await expect(page.getByTestId(`karte-fremd-${FIXTURE_REGION}`)).toBeVisible();

  // Katalogeinträge stehen in DERSELBEN Liste, nur weiter unten. Vorher
  // waren es zwei Abschnitte, und eine Karte wechselte beim Installieren den
  // Abschnitt — wer sie dort suchte, wo sie zuletzt stand, fand sie nicht.
  await expect(page.getByTestId('karte-liechtenstein')).toBeVisible();
  await expect(page.getByTestId('karte-liechtenstein')).toHaveAttribute(
    'data-zustand',
    'verfuegbar',
  );
  await expect(page.getByTestId('installieren-button-liechtenstein')).toHaveText('Installieren');

  // Deleting the only installed region must be refused (W-18-adjacent
  // "never half/zero map" rule) with a plain-language message, not a raw
  // error code.
  await page.getByTestId(`delete-button-${FIXTURE_REGION}`).click();
  const errorText = page.getByTestId(`region-error-${FIXTURE_REGION}`);
  await expect(errorText).toBeVisible();
  await expect(errorText).toContainText('letzte installierte Region');
  await expect(errorText).not.toContainText('LAST_REGION');

  // The region must still be installed after the refused delete.
  await expect(page.getByTestId(`karte-${FIXTURE_REGION}`)).toBeVisible();

  await page.waitForTimeout(300);
  for (const url of tracker.getAllUrls()) {
    expect(new URL(url).origin).toBe(CORE_BASE_URL);
  }
  expect(tracker.getForeignUrls()).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('regions panel is reachable and shows the catalog even with no map installed', async ({ page }) => {
  const tracker = await trackRequests(page, EMPTY_CORE_BASE_URL);
  const pageErrors = collectPageErrors(page);

  await page.goto(EMPTY_CORE_BASE_URL + '/');
  await expect(page.getByTestId('map-no-region')).toBeVisible({ timeout: 10_000 });

  await page.getByTestId('regions-panel-toggle').click();
  await expect(page.getByTestId('regions-panel')).toBeVisible();
  // Ohne installierte Karte ist die Liste nicht leer — der Katalog steht
  // darin. Was fehlt, ist etwas zu BAUEN, und das sagt der gemeinsame Knopf.
  await expect(page.getByTestId('karte-liechtenstein')).toBeVisible();
  await expect(page.getByTestId('installieren-button-liechtenstein')).toBeVisible();
  await expect(page.getByTestId('gesamtbau-ohne-karte')).toBeVisible();
  await expect(page.getByTestId('gesamtbau-button')).toBeDisabled();

  await page.waitForTimeout(300);
  for (const url of tracker.getAllUrls()) {
    expect(new URL(url).origin).toBe(EMPTY_CORE_BASE_URL);
  }
  expect(tracker.getForeignUrls()).toEqual([]);
  expect(pageErrors).toEqual([]);
});

// Die Gegenprobe: „kein Knopf" wäre auch dann grün, wenn die Oberfläche NIE
// einen Knopf zeigen könnte. Der Katalog wird hier abgefangen und enthält
// einen Eintrag MIT Quelle und einen komplett OHNE — der erste bekommt einen
// Knopf, der zweite nicht.
//
// Ein Knopf, der nicht funktionieren KANN, ist schlimmer als kein Knopf: er
// schickt den Betreiber auf die Fehlersuche in seiner eigenen Installation.
test('nur ein Eintrag MIT Quelle bekommt einen Knopf', async ({
  page,
}) => {
  await page.route('**/api/v1/map/regions/catalog', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: 'mitquelle',
            name: 'Mit eigener Quelle',
            url: 'http://127.0.0.1:9/mitquelle.pmtiles',
            sizeBytes: 1024,
            bounds: [0, 0, 1, 1],
            installed: false,
          },
          {
            id: 'perbau',
            name: 'Wird gebaut',
            pbfUrl: 'http://127.0.0.1:9/perbau.osm.pbf',
            sizeBytes: 1024,
            bounds: [0, 0, 1, 1],
            buildEffort: 'small',
            installed: false,
          },
          {
            // Weder fertige Datei noch OSM-Extrakt. Für diesen Eintrag
            // liesse sich nichts tun, also gibt es auch keinen Knopf.
            id: 'ohnequelle',
            name: 'Ohne jede Quelle',
            sizeBytes: 1024,
            bounds: [0, 0, 1, 1],
            installed: false,
          },
        ],
      }),
    });
  });

  await page.goto(EMPTY_CORE_BASE_URL + '/');
  await expect(page.getByTestId('map-no-region')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('regions-panel-toggle').click();
  await expect(page.getByTestId('regions-panel')).toBeVisible();

  // Beide Quellen ergeben DENSELBEN Knopf — das ist der Punkt: für den
  // Bedienenden ist es dieselbe Handlung, nur die Dauer unterscheidet sich.
  await expect(page.getByTestId('installieren-button-mitquelle')).toBeVisible();
  await expect(page.getByTestId('installieren-button-perbau')).toBeVisible();

  // Ohne jede Quelle: kein Knopf, aber ein Eintrag mit Begründung. Stumm
  // wegzulassen wäre die Fehlerklasse, die dieses Projekt am längsten
  // verfolgt.
  await expect(page.getByTestId('karte-ohnequelle')).toBeVisible();
  await expect(page.getByTestId('installieren-button-ohnequelle')).toHaveCount(0);
  await expect(page.getByTestId('karte-ohne-quelle-ohnequelle')).toBeVisible();
});

/**
 * Die Stil-Anfrage nennt KEINE Region — und das ist der Punkt.
 *
 * ─── DIESE PRÜFUNG STAND FRÜHER ANDERSHERUM DA ──────────────────────────────
 * Bis 0.10.0 sicherte sie zu, dass die Anfrage eine Region NENNT. Der Grund
 * war gut: davor entschied der Core allein und nahm die erste installierte
 * (`listRegions` sortiert alphabetisch). Mit Liechtenstein und
 * Rheinland-Pfalz installiert gewann damit immer Liechtenstein, während
 * Follow-Me die Kamera nach Rheinland-Pfalz zog — eine leere Karte, ohne
 * Fehler, ohne Hinweis.
 *
 * Seit 0.9.1 wählt der Core gar nichts mehr aus: nennt die Anfrage keine
 * Region, zeichnet er ALLE installierten gleichzeitig. Damit ist der alte
 * Fehler nicht mehr möglich — die Region unter dem Fahrzeug ist immer dabei —
 * und das Nennen einer einzigen ist von der Lösung zum Problem geworden.
 *
 * Gemeldet: „Die Schweiz und Liechtenstein erscheinen immer noch nicht auf
 * der Karte. Nur Deutschland ist zu sehen." Die Ursache war genau diese Zeile
 * in `MapView`, die 0.9.1 vollständig wirkungslos machte.
 *
 * ─── SEIT 0.16.0 GIBT ES GAR KEINE AUSNAHME MEHR ───────────────────────────
 * Bis 0.15.3 durfte eine FESTE Wahl im Kartenmenü doch eine Region nennen.
 * Diese Wahl ist entfallen — gewünscht war, dass immer alles Installierte zu
 * sehen ist. Damit lautet die Regel schlicht: NIE eine Region.
 *
 * Die Quelltext-Wache dazu steht in `src/map/alleRegionen.test.ts`; sie fängt
 * den Fall, dass `MapView` wieder eine durchreicht. Dieser Test hier prüft,
 * was am Ende wirklich über die Leitung geht.
 */
test('die Stil-Anfrage nennt NIE eine Region', async ({ page }) => {
  const tracker = await trackRequests(page, CORE_BASE_URL);

  await page.goto(CORE_BASE_URL + '/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

  const styleRequests = tracker.getAllUrls().filter((url) => url.includes('/api/v1/map/styles/'));
  expect(styleRequests.length, 'es wurde gar kein Stil geladen').toBeGreaterThan(0);

  for (const url of styleRequests) {
    const region = new URL(url).searchParams.get('region');
    expect(
      region,
      `Die Stil-Anfrage ${url} nennt eine Region. Dann zeichnet der Core NUR diese — ` +
        'wer mehrere Länder installiert hat, sieht nur eines davon.',
    ).toBeNull();
  }
});

/**
 * Der gemeinsame Bau zeigt, wo er steht und wie lange es noch dauert.
 *
 * ─── WAS HIER GEPRÜFT WIRD UND WAS NICHT ────────────────────────────────────
 * Nicht der Bau selbst — der dauert Stunden und braucht planetiler. Geprüft
 * wird die ANZEIGE: dass Schritt und Restzeit ankommen und dass die
 * Unterscheidung zwischen einer Schätzung und einer Untergrenze bis in den
 * Browser durchhält.
 *
 * Genau diese Unterscheidung ist das, was bei einer Nachbau-Rechnung in der
 * Oberfläche verloren ginge: eine Untergrenze, die wie eine Schätzung
 * aussieht, fällt immer zu kurz aus.
 */
test('der gemeinsame Bau zeigt Schritt und Restzeit', async ({ page }) => {
  const JOB = {
    id: 'job-gesamt',
    status: 'running',
    progress: 0,
    bytes: 0,
    totalBytes: null,
    error: null,
    note: 'Routing bauen (2 Karten) …',
    region: FIXTURE_REGION,
    bauart: 'gesamt',
    gesamt: {
      schritt: 2,
      schritte: 4,
      schrittText: 'Suche bauen (liechtenstein)',
      restSekunden: 900,
      restGrund: 'mindestens',
      restText: 'mindestens noch 15 Min. (ein Schritt läuft zum ersten Mal)',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await page.route('**/api/v1/map/regions/laufender-bau', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: JOB }) }),
  );
  await page.route(`**/api/v1/jobs/${JOB.id}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: JOB }) }),
  );

  await page.goto(CORE_BASE_URL + '/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('regions-panel-toggle').click();
  await expect(page.getByTestId('regions-panel')).toBeVisible();

  // Der Gesamtbau steht an SEINER Stelle — nicht unter einer einzelnen Karte.
  // Dort wäre er falsch einsortiert: er baut über alle.
  await expect(page.getByTestId('gesamtbau-schritt')).toContainText('Schritt 2 von 4');
  await expect(page.getByTestId('gesamtbau-schritt')).toContainText('Suche bauen (liechtenstein)');

  // Und die Restzeit trägt ihre Einschränkung mit. „noch etwa 15 Min." wäre
  // hier die gefährlichere Auskunft — sie fiele sicher zu kurz aus.
  const rest = page.getByTestId('gesamtbau-restzeit');
  await expect(rest).toContainText('mindestens noch 15 Min.');
  await expect(rest).toContainText('zum ersten Mal');
});

/**
 * Und ohne Erfahrungswerte steht dort KEINE Zahl.
 *
 * Beim ersten Bau einer Karte ist das der Normalfall. Eine erfundene Zahl
 * wäre hier besonders teuer: sie sieht überprüfbar aus.
 */
test('ohne Erfahrungswerte nennt der Bau keine Restzeit', async ({ page }) => {
  const JOB = {
    id: 'job-erstmalig',
    status: 'running',
    progress: 0,
    bytes: 0,
    totalBytes: null,
    error: null,
    note: 'Routing bauen (1 Karte) …',
    region: FIXTURE_REGION,
    bauart: 'gesamt',
    gesamt: {
      schritt: 1,
      schritte: 2,
      schrittText: 'Routing bauen (fixture)',
      restSekunden: null,
      restGrund: 'unbekannt',
      restText: null,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await page.route('**/api/v1/map/regions/laufender-bau', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: JOB }) }),
  );
  await page.route(`**/api/v1/jobs/${JOB.id}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: JOB }) }),
  );

  await page.goto(CORE_BASE_URL + '/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('regions-panel-toggle').click();
  await expect(page.getByTestId('regions-panel')).toBeVisible();

  const rest = page.getByTestId('gesamtbau-restzeit');
  await expect(rest).toContainText('noch unbekannt');
  // Die Gegenprobe: kein „0 Min.", kein „noch etwa". Ein leeres Feld oder
  // eine Null sähe aus wie „gleich fertig".
  await expect(rest).not.toContainText('noch etwa');
  await expect(rest).not.toContainText('0 Min.');
});

/**
 * ─── EIN LAUFENDER BAU MUSS EINEN NEUSTART DER SEITE ÜBERLEBEN ──────────────
 *
 * Gemeldet: „Wenn man von Yapaia woandershin wechselt und dann wieder aufruft
 * sind die aktuellen Fortschrittsinformationen vom Bau nicht mehr sichtbar."
 * Und beim nächsten Druck auf „bauen": „Es läuft bereits ein Bau."
 *
 * Beides stimmte gleichzeitig. Der Bau lief im Kern weiter — nur die
 * Zuordnung „welcher Job gehört zu welcher Region" lag im Speicher des
 * Browsers und war beim Verlassen der Seite weg.
 *
 * Genau das lässt sich NUR in einem echten Browser prüfen: ein Strukturtest
 * auf der Quelle kann nicht nachstellen, dass eine Seite neu geladen wird.
 * Der Kern wird deshalb hier vorgetäuscht, die Seite aber ist echt.
 */
test('ein laufender Bau ist nach dem Neuladen der Seite weiterhin sichtbar', async ({ page }) => {
  const LAUFEND = {
    id: 'job-abc',
    status: 'running',
    progress: 0,
    bytes: 0,
    totalBytes: null,
    error: null,
    note: '[INFO] Baue Routinggraph über germany, switzerland',
    region: FIXTURE_REGION,
    bauart: 'routing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Der Kern meldet einen laufenden Bau — so, wie er es nach einem Neuladen
  // der Seite auch täte, während planetiler oder Valhalla weiterarbeiten.
  await page.route('**/api/v1/map/regions/laufender-bau', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: LAUFEND }) }),
  );
  await page.route(`**/api/v1/jobs/${LAUFEND.id}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: LAUFEND }) }),
  );

  await page.goto(CORE_BASE_URL + '/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('regions-panel-toggle').click();
  await expect(page.getByTestId('regions-panel')).toBeVisible();

  // Der Fortschritt steht unter DER Region, zu der er gehört — nicht
  // irgendwo. An der falschen Stelle wäre er schlimmer als gar nicht.
  await expect(page.getByTestId(`download-progress-${FIXTURE_REGION}`)).toBeVisible();

  // Und die Statuszeile ist lesbar: ohne Terminal-Farbcodes, die im Browser
  // als sichtbarer Zeichensalat genau das Wort umklammern, auf das es
  // ankommt.
  const status = page.getByTestId(`job-status-${FIXTURE_REGION}`);
  await expect(status).toContainText('[INFO]');
  await expect(status).not.toContainText('[32;1m');
});
