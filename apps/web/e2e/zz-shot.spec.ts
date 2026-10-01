import { test, expect } from '@playwright/test';
import { CORE_BASE_URL } from './support/constants.js';
test.use({ viewport: { width: 1180, height: 820 }, serviceWorkers: 'block' });
for (const h of ['lhd', 'rhd'] as const) test('shot ' + h, async ({ page }) => {
  await page.goto(CORE_BASE_URL + '/');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15000 });
  await page.evaluate((hh) => window.__yapaiaHandednessStore?.getState().setHandedness(hh), h);
  await page.evaluate(() => window.__yapaiaPositionStore?.getState().setPosition({ lat: 47.14, lon: 9.52, alt: null, speed: 0, heading: null, accuracy: 5, source: 'browser', fix: '3d', ts: new Date().toISOString() }));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: process.env.SHOT!.replace('X', h) });
  if (h === 'lhd') { await page.getByTestId('einstellungen-toggle').click(); await page.waitForTimeout(500); await page.screenshot({ path: process.env.SHOT!.replace('X', 'menue') }); }
});
