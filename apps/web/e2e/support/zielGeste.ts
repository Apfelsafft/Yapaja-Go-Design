/**
 * Ein Ziel auf der Karte setzen — die Geste, an genau einer Stelle.
 *
 * ─── WARUM DAS EINE GEMEINSAME DATEI IST ────────────────────────────────────
 * Weil es vier Kopien davon gab. `clickMapCenter` stand wortgleich in
 * `routing.spec.ts`, `favorites.spec.ts`, `nav-control.spec.ts` und
 * `onboarding.spec.ts`, und eine fünfte, leicht andere Fassung in
 * `routing-avoid.spec.ts` und `control-overlap.spec.ts`.
 *
 * Solange die Geste ein schlichter Klick war, kostete das nichts. Als sie
 * sich änderte — seit 0.17.1 setzt ein kurzer Tipper kein Ziel mehr —,
 * fielen sechs Tests auf einmal aus, und jeder einzelne hätte von Hand
 * nachgezogen werden müssen. Die siebte Kopie im nächsten neuen Spec wäre
 * dann still wieder ein Klick gewesen.
 *
 * Das ist dieselbe Überlegung, aus der `POI_AUSWAHL` abgeleitet statt
 * abgeschrieben wird und `REDUCED_POI_CLASSES` keine zweite Liste mehr ist:
 * was an mehreren Stellen dasselbe sein MUSS, darf nicht an mehreren
 * Stellen STEHEN.
 */

import { expect, type Page } from '@playwright/test';

/**
 * Wie lange gedrückt wird, in Millisekunden.
 *
 * Deutlich über `DRUCKDAUER_MS` (500 in `src/routing/langerDruck.ts`): ein
 * Test, der am Zeitrand entlangschrammt, fällt irgendwann auf einem
 * langsameren Rechner aus, und zwar scheinbar grundlos.
 *
 * Bewusst KEIN Import der echten Konstante. Ein Test, der seine Erwartung
 * aus dem Prüfling bezieht, bestätigt nur, dass der Prüfling mit sich selbst
 * übereinstimmt — wer `DRUCKDAUER_MS` auf 5000 setzt, soll hier einen roten
 * Test bekommen und keinen, der stillschweigend mitwächst.
 */
export const DRUCK_MS = 800;

/** Drückt lange auf einen Punkt der Karte — in Seitenkoordinaten. */
export async function langDruecken(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(DRUCK_MS);
  await page.mouse.up();
}

/**
 * Setzt ein Ziel in der Mitte der Karte.
 *
 * Ersetzt das frühere `clickMapCenter`. Der Name nennt jetzt die Handlung
 * („Ziel setzen") und nicht mehr die Eingabe („klicken") — ein Helfer, der
 * `click` heißt und drückt, wäre die Sorte Kleinigkeit, an der später jemand
 * eine halbe Stunde sucht.
 */
export async function zielAufKartenmitte(page: Page): Promise<void> {
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
  expect(box, 'Die Karte hat keine Ausdehnung').not.toBeNull();
  await langDruecken(page, box!.x + box!.width / 2, box!.y + box!.height / 2);
}
