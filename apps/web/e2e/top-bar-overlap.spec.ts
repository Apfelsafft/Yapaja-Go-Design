/**
 * Kein Bedienelement in der Kopfzeile verdeckt ein anderes — bei JEDER
 * Fensterbreite.
 *
 * ─── WARUM ES DIESE DATEI GIBT ──────────────────────────────────────────────
 * Dieselbe Überlagerung hat dieses Projekt dreimal getroffen, und jedes Mal
 * mit demselben Ergebnis: ein Bedienelement ist da, wird gerendert, ist im DOM
 * vorhanden — und für den Menschen davor unerreichbar.
 *
 *   1. „GPS-Signal verloren" lag unter Titel und Profil-Chip.
 *      → „Kann sie nicht lesen da andere Objekte sie verdecken."
 *   2. Der Profil-Chip lag unter der Suchleiste, sobald deren `92vw` zog.
 *      → „Und ich sehe gerade nicht mehr wo ich die Fahrzeug Profile
 *         eingeben kann?"
 *
 * Nach dem ersten Fall habe ich das Banner verschoben. Das war eine Reparatur
 * am Symptom — der zweite Fall kam vier Stunden später. Deshalb prüft dieser
 * Test nicht EIN Element, sondern die Regel: in der Kopfzeile darf nichts
 * etwas anderes überlagern.
 *
 * ─── WARUM `elementFromPoint` UND NICHT `toBeVisible()` ─────────────────────
 * `toBeVisible()` war in BEIDEN Fällen grün. Es sagt, dass ein Element
 * gerendert und nicht `display:none` ist — nicht, dass man es sehen kann. Die
 * einzige Frage, die zählt, ist: was liegt an dieser Stelle obenauf?
 *
 * ─── UND WARUM MEHRERE BREITEN ──────────────────────────────────────────────
 * Fall 2 trat NUR auf schmalen Fenstern auf. Auf dem breiten Testfenster war
 * alles in Ordnung, und genau deshalb ist er durch die CI gekommen. Ein Test
 * bei einer einzigen Breite hätte ihn wieder durchgelassen.
 */

import { test, expect, type Page } from '@playwright/test';
import { CORE_BASE_URL } from './support/constants.js';

/** Breiten, bei denen die Zeile eng wird. 1280 = das übliche Testfenster,
 *  900 = ein iPad neben der HA-Seitenleiste (der gemeldete Fall), 600 = ein
 *  Telefon quer. */
const WIDTHS = [1280, 900, 600];

/** Die Bedienelemente der Kopfzeile, die einander nicht verdecken dürfen. */
const TOP_BAR_CONTROLS = ['profile-chip-name', 'search-input'];

interface Coverage {
  testid: string;
  covered: string[];
}

/**
 * Fragt für jedes genannte Element, was an drei Stellen seiner Fläche
 * tatsächlich obenauf liegt. Alles, was weder das Element selbst noch ein
 * Kind davon ist, verdeckt es.
 */
async function findCoveringElements(page: Page, testids: string[]): Promise<Coverage[]> {
  return page.evaluate((ids) => {
    const out: Array<{ testid: string; covered: string[] }> = [];
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) {
        continue;
      }
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) {
        continue;
      }
      const samples = [0.2, 0.5, 0.8].map((f) => ({
        x: box.left + box.width * f,
        y: box.top + box.height * 0.5,
      }));
      const covered = samples
        .map(({ x, y }) => document.elementFromPoint(x, y))
        .filter((hit) => hit !== null && hit !== el && !el.contains(hit))
        .map((hit) => {
          const owner = (hit as Element).closest('[data-testid]');
          return owner?.getAttribute('data-testid') ?? (hit as Element).tagName.toLowerCase();
        });
      out.push({ testid: id, covered: [...new Set(covered)] });
    }
    return out;
  }, testids);
}

for (const width of WIDTHS) {
  test(`Kopfzeile bei ${width}px: kein Bedienelement verdeckt ein anderes`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(CORE_BASE_URL + '/');
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('top-bar')).toBeVisible();

    const coverage = await findCoveringElements(page, TOP_BAR_CONTROLS);

    // Plausibilität: findet der Test gar keins der Elemente, prüft er nichts.
    expect(
      coverage.length,
      `Keines der Kopfzeilen-Elemente (${TOP_BAR_CONTROLS.join(', ')}) war im DOM — ` +
        'dann prüft dieser Test nichts. Wurden die testids umbenannt?',
    ).toBeGreaterThan(0);

    for (const entry of coverage) {
      expect(
        entry.covered,
        `„${entry.testid}" wird bei ${width}px von ${entry.covered.join(', ')} verdeckt und ` +
          'ist damit nicht bedienbar.',
      ).toEqual([]);
    }
  });
}

/**
 * Und der Chip muss überhaupt da sein. Ein Element, das bei schmalen Fenstern
 * aus dem sichtbaren Bereich rutscht, wird von der Überlagerungsprüfung oben
 * nicht erfasst — es verdeckt ja niemand, es ist nur weg.
 */
test('das Fahrzeugprofil ist auf jeder Breite sichtbar und im Fenster', async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(CORE_BASE_URL + '/');
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

    const chip = page.getByTestId('profile-chip-name');
    await expect(chip, `Profil-Chip fehlt bei ${width}px`).toBeVisible();

    const box = await chip.boundingBox();
    expect(box, `Profil-Chip hat bei ${width}px keine Fläche`).not.toBeNull();
    if (box) {
      expect(box.x, `Profil-Chip ist bei ${width}px links aus dem Fenster gerutscht`).toBeGreaterThanOrEqual(0);
      expect(
        box.x + box.width,
        `Profil-Chip ragt bei ${width}px rechts aus dem Fenster`,
      ).toBeLessThanOrEqual(width);
    }
  }
});
