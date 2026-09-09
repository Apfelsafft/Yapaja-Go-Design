/**
 * Der Bildschirm bleibt an.
 *
 * ─── WAS HIER WIRKLICH GEPRUEFT WIRD ────────────────────────────────────────
 * Ob ein iPad einschlaeft, kann kein Browsertest beantworten. Was er
 * beantworten kann, ist die Frage davor, an der es scheitern wuerde: LAEUFT
 * ueberhaupt etwas, das den Bildschirm wachhaelt -- und laeuft es auch dort,
 * wo es `navigator.wakeLock` NICHT gibt?
 *
 * Der zweite Fall ist der entscheidende. Home Assistant laeuft in dieser
 * Installation ueber einfaches HTTP, und ohne sicheren Kontext gibt es die
 * Schnittstelle nicht. Der Test loescht sie deshalb absichtlich weg und
 * prueft, dass das Video wirklich SPIELT -- nicht, dass ein Element existiert.
 * Ein Video-Element, das nicht spielt, haelt nichts wach und sieht in der
 * Seite genauso aus wie eines, das spielt.
 */

import { test, expect, type Page } from '@playwright/test';
import { CORE_BASE_URL } from './support/constants.js';

/** Schaltet `navigator.wakeLock` ab -- der Zustand ueber einfaches HTTP. */
async function ohneWakeLock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // `delete` genuegt nicht: die Eigenschaft haengt am Prototyp.
    Object.defineProperty(navigator, 'wakeLock', { get: () => undefined, configurable: true });
  });
}

/** Der Zustand, den `ScreenAwakeController` nach aussen meldet. */
async function zustand(page: Page): Promise<{ methode: string; gewuenscht: boolean }> {
  return page.evaluate(() => {
    const z = window.__yapaiaScreenAwake?.();
    return { methode: z?.methode ?? 'fehlt', gewuenscht: z?.gewuenscht ?? false };
  });
}

/** Spielt das Rueckfall-Video wirklich? Gemessen an der laufenden Zeit. */
async function videoSpielt(page: Page): Promise<boolean> {
  const video = page.locator('video');
  await expect(video).toHaveCount(1);
  const vorher = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await page.waitForTimeout(700);
  return video.evaluate(
    (v: HTMLVideoElement, t: number) => !v.paused && !v.ended && v.currentTime !== t,
    vorher,
  );
}

test.describe('Bildschirm wachhalten', () => {
  test('nutzt die Schnittstelle, wo es sie gibt', async ({ page }) => {
    // 127.0.0.1 gilt dem Browser als sicherer Kontext, hier gibt es sie also.
    await page.goto(CORE_BASE_URL);
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await zustand(page)).methode).toBe('wakelock');
  });

  test('haelt ohne die Schnittstelle mit dem Video wach', async ({ page }) => {
    await ohneWakeLock(page);
    await page.goto(CORE_BASE_URL);
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

    await expect.poll(async () => (await zustand(page)).methode).toBe('video');
    expect(await videoSpielt(page), 'das Rueckfall-Video laeuft nicht').toBe(true);
  });

  test('und tut das auch in der Dashboard-Kachel', async ({ page }) => {
    // Genau der Fall aus der Bestellung: das Tablet zeigt das Dashboard.
    await ohneWakeLock(page);
    await page.goto(`${CORE_BASE_URL}/embed.html`);
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

    await expect.poll(async () => (await zustand(page)).methode).toBe('video');
    expect(await videoSpielt(page)).toBe(true);
  });

  test('das Video stoert die Bedienung nicht', async ({ page }) => {
    // Es liegt hinter allem und nimmt keine Beruehrung an. Waere das anders,
    // haette der Betreiber einen unsichtbaren Fleck auf der Karte.
    await ohneWakeLock(page);
    await page.goto(CORE_BASE_URL);
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

    const stil = await page
      .locator('video')
      .evaluate((v) => {
        const s = getComputedStyle(v);
        return { zeiger: s.pointerEvents, ebene: s.zIndex, breite: v.getBoundingClientRect().width };
      });
    expect(stil.zeiger).toBe('none');
    expect(Number(stil.ebene)).toBeLessThan(0);
    expect(stil.breite).toBeLessThanOrEqual(4);
  });
});
