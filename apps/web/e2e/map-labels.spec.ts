/**
 * Beweist, dass die Karte überhaupt Schrift zeichnen kann.
 *
 * ─── WARUM ES DIESEN TEST GIBT ──────────────────────────────────────────────
 * Bis 0.3.6 hatten unsere Stile kein `glyphs`. MapLibre zeichnet dann KEINEN
 * Buchstaben — es gab sechs Symbol-Ebenen (Orte, Straßennamen, Gewässer,
 * Gipfel, POIs) und auf dem Bildschirm nie einen Namen. Es gab dafür keine
 * Fehlermeldung; die Karte sah einfach aus, als gäbe es hier nichts zu
 * beschriften. Gemeldet wurde es als „die Karten sehen irgendwie langweilig
 * aus".
 *
 * Ein Unit-Test kann das NICHT abschließend prüfen. Ob am Ende Text auf dem
 * Bildschirm steht, hängt an vier Dingen gleichzeitig: `glyphs` im Stil, ein
 * `text-font`, für das Dateien ausgeliefert werden, ein Server, der sie
 * herausgibt, und eine URL, die auch unter dem Ingress-Unterpfad noch stimmt.
 * Jedes davon versagt still. Deshalb wird hier gemessen, was WIRKLICH auf der
 * Leinwand landet.
 *
 * ─── WARUM EINE EIGENE QUELLE STATT DER KACHELN ─────────────────────────────
 * Die Testumgebung hat keine echten Kacheldaten. Der Nachweis darf davon aber
 * nicht abhängen: er soll die Schrift prüfen, nicht die Datenlage. Also wird
 * ein einzelner beschrifteter Punkt in die Bildmitte gelegt, in einer Farbe,
 * die sonst nirgends auf der Karte vorkommt, und anschließend gezählt, wie
 * viele Pixel diese Farbe tragen. Kein Text ⇒ kein Pixel.
 */

import { test, expect, type Page } from '@playwright/test';
import { CORE_BASE_URL, CORE_PORT, SUBPATH_BASE_URL, SUBPATH_PORT, SUBPATH_PREFIX, WEB_DIST_DIR } from './support/constants.js';
import { startSubpathServer, type SubpathServerHandle } from './support/subpathServer.js';

/** Schriftfarbe der Sonde — kommt in keiner unserer Paletten vor. */
const PROBE_RGB = { r: 255, g: 0, b: 0 };

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

/**
 * Legt einen beschrifteten Punkt in die Bildmitte und zählt die Pixel seiner
 * Schriftfarbe. Gibt zusätzlich die Fehler zurück, die MapLibre dabei meldet —
 * eine fehlende Schrift steht sonst nur in der Browserkonsole.
 */
async function renderProbeLabelAndCountPixels(
  page: Page,
): Promise<{ glyphs: string | null; textPixels: number; errors: string[] }> {
  return page.evaluate(async (rgb) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const map: any = window.__yapajaMapController!.getMap!();
    const errors: string[] = [];
    map.on('error', (e: any) => errors.push(e?.error?.message ?? 'unbekannt'));

    const glyphs: string | null = map.getStyle().glyphs ?? null;
    const center = map.getCenter();

    map.addSource('label-probe', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [center.lng, center.lat] },
            properties: { name: 'ABCDEFG' },
          },
        ],
      },
    });
    map.addLayer({
      id: 'label-probe-text',
      type: 'symbol',
      source: 'label-probe',
      layout: {
        'text-field': ['get', 'name'],
        // Derselbe Schnitt, mit dem die echten Ebenen beschriftet werden.
        'text-font': ['noto-sans-regular'],
        'text-size': 48,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` },
    });

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 8000);
      map.once('idle', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 800));

    const canvas = document.querySelector('canvas.maplibregl-canvas') as HTMLCanvasElement;
    const gl = (canvas.getContext('webgl2') ||
      canvas.getContext('webgl')) as WebGLRenderingContext;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    let textPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 180 && pixels[i + 1] < 90 && pixels[i + 2] < 90) {
        textPixels++;
      }
    }
    return { glyphs, textPixels, errors };
  }, PROBE_RGB);
}

test('die Karte zeichnet Schrift — Glyphen werden geladen und landen auf der Leinwand', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const glyphResponses: Array<{ path: string; status: number }> = [];
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.includes('/fonts/')) {
      glyphResponses.push({ path, status: response.status() });
    }
  });

  await page.goto(CORE_BASE_URL + '/');
  await waitForMapReady(page);

  const result = await renderProbeLabelAndCountPixels(page);

  expect(result.glyphs, 'der Stil nennt keine Glyphenquelle').toBeTruthy();
  expect(
    result.textPixels,
    'kein einziges Textpixel auf der Leinwand — MapLibre zeichnet keine Schrift. ' +
      `MapLibre meldete: ${JSON.stringify(result.errors)}`,
  ).toBeGreaterThan(0);

  // Der Server muss die Zeichen auch wirklich herausgeben.
  expect(glyphResponses.length, 'es wurde nie eine Glyphendatei angefragt').toBeGreaterThan(0);
  for (const response of glyphResponses) {
    expect(response.status, `${response.path} kam mit ${response.status} zurück`).toBe(200);
  }
});

/**
 * ─── DER FALL, IN DEM EINE RELATIVE URL BRICHT ──────────────────────────────
 * Die Glyphen-URL ist seitenrelativ (`./fonts/…`), genau wie die Kachel-URL.
 * Unter dem HA-Ingress läuft die App aber unter `/hassio_ingress/<token>/`
 * (W-15). Eine root-relative URL (`/fonts/…`) würde dort am Präfix vorbei
 * zielen und ins Leere laufen — und zwar ausschließlich beim Betreiber, nie
 * hier in der Entwicklung. Diesen Unterschied prüft nur ein Test unter dem
 * echten Unterpfad.
 */
test.describe('unter dem Ingress-Unterpfad', () => {
  let handle: SubpathServerHandle;

  test.beforeAll(async () => {
    handle = await startSubpathServer({
      prefix: SUBPATH_PREFIX,
      distDir: WEB_DIST_DIR,
      corePort: CORE_PORT,
      port: SUBPATH_PORT,
    });
  });

  test.afterAll(async () => {
    await handle.close();
  });

  test('lädt die Schriftzeichen innerhalb des Unterpfads und zeichnet Text', async ({ page }) => {
    test.setTimeout(60_000);
    const glyphResponses: Array<{ path: string; status: number }> = [];
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (path.includes('/fonts/')) {
        glyphResponses.push({ path, status: response.status() });
      }
    });

    await page.goto(`${SUBPATH_BASE_URL}${SUBPATH_PREFIX}/`);
    await waitForMapReady(page);

    const result = await renderProbeLabelAndCountPixels(page);
    expect(
      result.textPixels,
      'unter dem Unterpfad steht kein Text auf der Karte — die Glyphen-URL zielt ' +
        `am Ingress-Präfix vorbei. MapLibre meldete: ${JSON.stringify(result.errors)}`,
    ).toBeGreaterThan(0);

    expect(glyphResponses.length, 'es wurde nie eine Glyphendatei angefragt').toBeGreaterThan(0);
    for (const response of glyphResponses) {
      expect(
        response.path.startsWith(SUBPATH_PREFIX),
        `"${response.path}" liegt ausserhalb von "${SUBPATH_PREFIX}" — die URL ist nicht ` +
          'seitenrelativ und bricht damit hinter dem HA-Ingress.',
      ).toBe(true);
      expect(response.status).toBe(200);
    }
  });
});
