/**
 * Ein stehendes Fahrzeug meldet keinen GPS-Ausfall.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Du hast den GPS-Timeout eingestellt, wenn sich das Gerät nicht bewegt, und
 * es wird GPS inaktiv angezeigt. […] Wenn das Wohnmobil länger an einem Ort
 * steht, sieht es so aus, als ob man kein GPS-Empfang hat."
 *
 * ─── WARUM DAS HIER UND NICHT NUR IM UNIT-TEST STEHT ────────────────────────
 * `standstill.test.ts` belegt die REGEL. Ob sie im laufenden Programm auch
 * ankommt, haengt an drei Stellen dazwischen: der Positionsspeicher muss den
 * vorherigen Fix aufheben, `useGpsSignalState` muss beide lesen, und das
 * Banner muss auf den neuen Zustand hoeren. Genau solche Verdrahtungsluecken
 * sind in diesem Projekt schon mehrfach durchgerutscht.
 *
 * Beide Richtungen werden geprueft: das Banner darf im Stand NICHT kommen --
 * und bei Fahrt ohne Daten SEHR WOHL. Nur die erste Haelfte zu pruefen waere
 * auch dann gruen, wenn ich das Banner einfach abgeschaltet haette.
 */

import { test, expect, type Page } from '@playwright/test';
import { DRIVE_CORE_BASE_URL } from './support/constants.js';

const LAT = 47.2;
const LON = 9.6;

/** Ueber der Schwelle aus `gpsSignal.ts` (3 s), mit Luft fuer den 500-ms-Takt. */
const STALE_WAIT_MS = 4500;

async function postFix(page: Page, speed: number, latOffset = 0): Promise<void> {
  const response = await page.request.post(`${DRIVE_CORE_BASE_URL}/api/v1/position/browser`, {
    data: {
      lat: LAT + latOffset,
      lon: LON,
      alt: null,
      speed,
      heading: 0,
      accuracy: 5,
      fix: '3d',
      ts: new Date().toISOString(),
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => Boolean(window.__yapajaMapController?.getMap?.()), undefined, {
    timeout: 15_000,
  });
}

/** Warten, bis ein echter Fix im Speicher steht -- sonst gilt „acquiring"
 *  und beide Zusicherungen unten waeren aus dem falschen Grund gruen. */
async function waitForRealFix(page: Page): Promise<void> {
  await expect
    .poll(
      () => page.evaluate(() => window.__yapajaPositionStore?.getState().lastRealUpdateTime !== null),
      { timeout: 20_000 },
    )
    .toBe(true);
}

test.describe('GPS-Anzeige im Stand', () => {
  test.describe.configure({ mode: 'serial' });

  test('stehendes Fahrzeug: kein „GPS-Signal verloren", obwohl keine Daten mehr kommen', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto(DRIVE_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    // Zwei Fixe am selben Ort mit Tempo 0 -- so steht ein geparktes
    // Wohnmobil da, und danach kommt nichts mehr.
    await postFix(page, 0);
    await postFix(page, 0);
    await waitForRealFix(page);

    await page.waitForTimeout(STALE_WAIT_MS);

    // Der gemeldete Fehler: hier stand „GPS-Signal verloren".
    await expect(page.getByTestId('gps-loss-banner')).toHaveCount(0);
    expect(
      await page.evaluate(() => window.__yapajaPositionStore?.getState().lastRealUpdateTime !== null),
    ).toBe(true);
  });

  test('fahrendes Fahrzeug ohne Daten: das Banner kommt weiterhin', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(DRIVE_CORE_BASE_URL + '/');
    await waitForMapReady(page);

    // Deutlich in Bewegung, an zwei verschiedenen Orten -- und dann Stille.
    await postFix(page, 15, 0);
    await postFix(page, 15, 0.002);
    await waitForRealFix(page);

    await page.waitForTimeout(STALE_WAIT_MS);

    // Das ist der Fall, fuer den die Warnung gedacht war. Sie bleibt.
    await expect(page.getByTestId('gps-loss-banner')).toBeVisible({ timeout: 5_000 });
  });
});
