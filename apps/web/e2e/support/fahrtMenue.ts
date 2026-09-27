/**
 * Das Fahrtmenü öffnen -- seit 0.18.0 liegen Pause, Stopp und die
 * Ansagen-Taste dahinter (`src/drive/FahrtMenue.tsx`).
 *
 * Idempotent: ist es schon offen, passiert nichts. Ein zweiter Tipp auf die
 * Fahrtdaten schlösse es sonst wieder.
 */

import { expect, type Page } from '@playwright/test';

export async function oeffneFahrtMenue(page: Page): Promise<void> {
  const menue = page.getByTestId('fahrt-menue');
  if (await menue.isVisible()) return;
  await page.getByTestId('trip-info-panel').click();
  await expect(menue).toBeVisible({ timeout: 5_000 });
}
