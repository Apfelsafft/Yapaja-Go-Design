/**
 * Resolve the pre-installed Chromium binary under `PLAYWRIGHT_BROWSERS_PATH`.
 *
 * Extracted verbatim from `apps/web/playwright.config.ts` in E09-T6 so the
 * dedicated security-suite Playwright config (`e2e/security/playwright.config.ts`)
 * resolves the browser identically instead of duplicating the logic.
 *
 * This environment ships a specific Chromium revision at
 * `PLAYWRIGHT_BROWSERS_PATH` that does not necessarily match the revision
 * `@playwright/test`'s own browser auto-resolution expects, and
 * `playwright install` must not be run here. Pointing `executablePath`
 * directly at the installed binary sidesteps that mismatch. Falls back to
 * Playwright's own resolution (`undefined`) if the env var isn't set, e.g. on
 * a CI runner with a normal `playwright install`.
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

export function resolvePreinstalledChromium(): string | undefined {
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!browsersPath || !existsSync(browsersPath)) {
    return undefined;
  }
  const candidateDirs = readdirSync(browsersPath).filter(
    (name) => name.startsWith('chromium-') && !name.startsWith('chromium_headless_shell'),
  );
  for (const dir of candidateDirs) {
    const candidate = join(browsersPath, dir, 'chrome-linux', 'chrome');
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}
