/**
 * Der Sicherheitsdialog „Stimmen die Maße deines Fahrzeugs?".
 *
 * ─── WAS HIER BEWIESEN WIRD, UND WARUM NUR HIER ─────────────────────────────
 * Beim ersten Start entsteht ein Profil „Camper" mit 3,00 m Hoehe. Diese Zahl
 * ist GERATEN, geht aber ununterscheidbar von einer gemessenen als `height` an
 * Valhalla. Der Weg dorthin war offen: der Fahrzeug-Schritt des Assistenten
 * ist ueberspringbar, und freigeschaltet wird die Navigation nur vom
 * Haftungshinweis.
 *
 * Unit-Tests belegen die Regel („nie bestaetigt" -> Hinweis noetig). Dass der
 * Dialog dann auch WIRKLICH erscheint und der Knopf wirkt, kann nur ein Lauf
 * gegen den echten Core zeigen -- genau die Luecke, durch die in diesem
 * Projekt schon mehrfach etwas durchgerutscht ist.
 *
 * Dieser Spec hat einen EIGENEN Core: `globalSetup` bestaetigt die Masse auf
 * allen anderen (sonst laege der Dialog ueber 40+ Specs), und ein
 * „Bestaetigung zuruecknehmen" gibt es bewusst nicht.
 */

import { test, expect } from '@playwright/test';
import { DIMENSIONS_CORE_BASE_URL } from './support/constants.js';

test.describe.configure({ mode: 'serial' });

test.use({ baseURL: DIMENSIONS_CORE_BASE_URL });

test('der Dialog erscheint, nennt die tatsaechlichen Masse und laesst sich beantworten', async ({
  page,
}) => {
  await page.goto('/');

  const dialog = page.getByTestId('unconfirmed-dimensions-banner');
  await expect(dialog).toBeVisible();

  // Die Zahlen stehen absichtlich drin: „3,00 m hoch" ist bei einem
  // 3,20-m-Fahrzeug sofort als falsch zu erkennen, eine allgemeine Warnung
  // nicht. Genau das ist der Zweck der ganzen Anzeige.
  await expect(page.getByTestId('unconfirmed-dimensions-values')).toContainText('3,00 m hoch');

  await page.getByTestId('confirm-dimensions-button').click();

  // Weg -- und zwar dauerhaft, nicht nur optisch.
  await expect(dialog).toHaveCount(0);

  const profiles = await page.request.get(`${DIMENSIONS_CORE_BASE_URL}/api/v1/profiles`);
  const body = (await profiles.json()) as {
    data: { is_active: boolean; dimensions_confirmed_at: string | null }[];
  };
  const active = body.data.find((p) => p.is_active);
  expect(active?.dimensions_confirmed_at).not.toBeNull();

  // Und nach einem Neuladen bleibt er weg: die Bestaetigung steht in der
  // Datenbank, nicht im Speicher der Seite.
  await page.reload();
  await expect(page.getByTestId('unconfirmed-dimensions-banner')).toHaveCount(0);
});
