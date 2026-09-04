/**
 * Die Anzeigeseite für die Home-Assistant-Dashboard-Karte.
 *
 * ─── WAS HIER GEPRÜFT WIRD, UND WAS NICHT ───────────────────────────────────
 * Die Lovelace-Karte (`yapaja_go/lovelace/yapaja-map-card.js`) lädt genau
 * diese Seite in ihren Rahmen. Ob der Ingress-Handschlag in Home Assistant
 * klappt, lässt sich hier nicht prüfen — dafür bräuchte es eine laufende
 * HA-Instanz. Was sich prüfen lässt, ist die Seite selbst:
 *
 *   * sie zeigt eine Karte,
 *   * sie zeigt KEINE Bedienelemente,
 *   * sie lässt sich einbetten (`frame-ancestors 'self'`),
 *   * sie holt nichts von fremden Servern.
 *
 * Der zweite Punkt ist der wichtigste. Eine Dashboard-Kachel, in der man
 * versehentlich den Kartenstil umstellt oder — schlimmer — die laufende
 * Navigation anfasst, wäre eine Falle. Ohne diese Prüfung würde ein neues
 * Bedienelement in `MapView` still auch in der Kachel auftauchen.
 */

import { test, expect } from '@playwright/test';
import { CORE_BASE_URL } from './support/constants.js';
import { trackRequests, collectPageErrors } from './support/network.js';

/** Bedienelemente, die es in der Kachel NICHT geben darf. */
const FORBIDDEN_CONTROLS = [
  'style-panel-toggle',
  'regions-panel-toggle',
  'store-panel-toggle',
  'preflight-panel-toggle',
  'recenter-button',
  'viewmode-button',
  'compass-button',
  'search-input',
];

test.describe('Anzeigeseite fuer das HA-Dashboard (embed.html)', () => {
  test('zeigt eine Karte', async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await page.goto(`${CORE_BASE_URL}/embed.html`);
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
    expect(pageErrors).toEqual([]);
  });

  /** ─── DER EIGENTLICHE PUNKT ──────────────────────────────────────────── */
  test('zeigt kein einziges Bedienelement', async ({ page }) => {
    await page.goto(`${CORE_BASE_URL}/embed.html`);
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });

    for (const testId of FORBIDDEN_CONTROLS) {
      await expect(
        page.locator(`[data-testid="${testId}"]`),
        `"${testId}" erscheint in der Dashboard-Kachel — dort gehoert kein Bedienelement hin`,
      ).toHaveCount(0);
    }
  });

  /**
   * Die Karte im Dashboard bettet diese Seite in einen `<iframe>` ein. Setzte
   * der Core `frame-ancestors 'none'`, bliebe die Kachel leer — und zwar
   * ohne sichtbaren Fehler, nur mit einer Meldung in der Browserkonsole.
   */
  test('darf eingebettet werden', async ({ page }) => {
    const response = await page.goto(`${CORE_BASE_URL}/embed.html`);
    expect(response).not.toBeNull();
    const csp = response!.headers()['content-security-policy'] ?? '';
    expect(csp, 'die Seite liefert keine CSP').toBeTruthy();
    expect(csp).toContain("frame-ancestors 'self'");
    expect(response!.headers()['x-frame-options'] ?? '').not.toBe('DENY');
  });

  test('holt nichts von fremden Servern', async ({ page }) => {
    const tracker = await trackRequests(page, CORE_BASE_URL);
    await page.goto(`${CORE_BASE_URL}/embed.html`);
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 15_000 });
    expect(tracker.getForeignUrls()).toEqual([]);
  });
});
