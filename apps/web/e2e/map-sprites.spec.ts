/**
 * Die Bildsymbole der Karte kommen wirklich an.
 *
 * ─── WARUM ES DIESE PRÜFUNG GIBT ────────────────────────────────────────────
 * Gemeldet: „Können wir vielleicht kleine Icons für die POIs einblenden? Ich
 * erkenne nicht auf Anhieb, wo bspw. ein Womo-Stellplatz ist."
 *
 * Die Icons gab es -- gezeichnet wurde keines, auch kein Straßenschild.
 * MapLibre 6 verwirft eine relative `sprite`-Adresse und sagt das nur in der
 * Konsole. Jede Prüfung blieb grün, weil keine fragte, ob ein Bild GELADEN
 * ist; geprüft wurde nur, dass der Stil eines NENNT. Diese Datei fragt die
 * Karte selbst.
 */

import { test, expect } from '@playwright/test';
import { CORE_BASE_URL } from './support/constants.js';

for (const dpr of [1, 2]) {
  test(`Symbole sind geladen (Pixeldichte ${dpr})`, async ({ browser }) => {
    const context = await browser.newContext({ deviceScaleFactor: dpr });
    const page = await context.newPage();
    const spriteFehler: string[] = [];
    page.on('console', (m) => {
      if (/sprite/i.test(m.text())) spriteFehler.push(m.text());
    });

    await page.goto(CORE_BASE_URL + '/');
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

    const hat = (name: string) =>
      page.evaluate((n) => Boolean(window.__yapaiaMapController?.getMap()?.hasImage(n)), name);
    // Je eine POI-Marke und ein Schild -- beide aus demselben Blatt.
    await expect.poll(() => hat('poi-wohnmobil'), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => hat('poi-frischwasser')).toBe(true);
    await expect.poll(() => hat('shield-trunk')).toBe(true);

    expect(spriteFehler).toEqual([]);
    await context.close();
  });
}
