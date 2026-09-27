/**
 * Der Verkehrshinweis bleibt nicht stehen.
 *
 * Gemeldet: „Zusätzlich sehe ich eine Anzeige dass die verkehrsinformationen
 * 17 Minuten alt sind. Die war die ganze Zeit über sichtbar, für längere
 * Zeit."
 *
 * Der Zustand wird direkt in den Store geschrieben
 * (`window.__yapaiaVerkehrStore`) -- ein echter Abruf braucht eine Route über
 * eine Autobahn UND die Autobahn-API im Netz, und beides hat dieser Test
 * nicht. Geprüft wird hier nur, was die Anzeige mit einem Befund macht; was
 * sie sagt, prüft `verkehrHinweisText.test.ts`.
 */

import { test, expect, type Page } from '@playwright/test';
import { CORE_BASE_URL } from './support/constants.js';

type Strasse = { strasse: string; quelle: 'frisch' | 'zwischenspeicher' | 'fehler'; alter_s?: number };

async function setzeBefund(page: Page, strassen: Strasse[]): Promise<void> {
  await page.evaluate((s) => {
    window.__yapaiaVerkehrStore!.setState({ strassen: s, ohneOrt: 0, fehler: null } as never);
  }, strassen);
}

test.describe('Verkehrshinweis', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(CORE_BASE_URL + '/');
    await page.waitForFunction(() => Boolean(window.__yapaiaVerkehrStore));
  });

  test('ein Altersvermerk verschwindet von selbst -- und kommt mit dem Alter nicht zurück', async ({
    page,
  }) => {
    test.setTimeout(40_000);
    const hinweis = page.getByTestId('verkehr-hinweis');

    await setzeBefund(page, [{ strasse: 'A5', quelle: 'zwischenspeicher', alter_s: 16 * 60 }]);
    await expect(hinweis).toContainText('A5');

    // HINWEIS_SICHTBAR_MS = 10 s.
    await expect(hinweis).toBeHidden({ timeout: 15_000 });

    // Eine Minute später: dieselbe Straße, nur älter. Kein neuer Hinweis.
    await setzeBefund(page, [{ strasse: 'A5', quelle: 'zwischenspeicher', alter_s: 17 * 60 }]);
    await page.waitForTimeout(500);
    await expect(hinweis).toBeHidden();

    // Eine ANDERE Straße ist eine neue Auskunft.
    await setzeBefund(page, [{ strasse: 'A61', quelle: 'zwischenspeicher', alter_s: 60 }]);
    await expect(hinweis).toContainText('A61');
  });

  test('eine Warnung bleibt stehen, lässt sich aber wegtippen', async ({ page }) => {
    const hinweis = page.getByTestId('verkehr-hinweis');
    await setzeBefund(page, [{ strasse: 'A3', quelle: 'fehler' }]);
    await expect(hinweis).toContainText('keine Verkehrsdaten');

    await hinweis.getByRole('status').click();
    await expect(hinweis).toBeHidden();
  });
});
