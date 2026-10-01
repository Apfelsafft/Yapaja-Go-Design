import type { Page } from '@playwright/test';

/**
 * Öffnet einen Bereich des ⚙-Menüs (seit 0.23, shell/EinstellungsMenue.tsx).
 *
 * Bis 0.22 hatte jeder Bereich einen eigenen runden Knopf auf der Karte; die
 * Kennungen dieser Knöpfe (`style-panel-toggle` …) tragen jetzt die
 * Menüeinträge. Ist schon ein anderer Bereich offen, geht es erst zurück.
 */
export async function oeffneEinstellung(page: Page, eintrag: string): Promise<void> {
  const menue = page.getByTestId('einstellungen-menue');
  if (!(await menue.isVisible())) await page.getByTestId('einstellungen-toggle').click();
  const zurueck = page.getByTestId('einstellungen-zurueck');
  if (await zurueck.isVisible()) await zurueck.click();
  await page.getByTestId(eintrag).click();
}

/** Schließt das ⚙-Menü, falls offen. */
export async function schliesseEinstellungen(page: Page): Promise<void> {
  const zu = page.getByTestId('einstellungen-schliessen');
  if (await zu.isVisible()) await zu.click();
}
