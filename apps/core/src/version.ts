/**
 * Reads the Core's own `package.json` version (moved out of `index.ts`
 * verbatim, E09-T1). Used by `/api/v1/health`, the HA discovery
 * `sw_version` (`mqtt/discovery.ts`), and now the add-on install pipeline's
 * `core_api` semver-range check (`addons/installService.ts`, Wargame W-11).
 *
 * After a tsup bundle, EVERY module's `import.meta.url` resolves to the
 * single bundled `dist/index.js` (see `tsup.config.ts`'s comment), so
 * moving this out of `index.ts` into its own file does not change the
 * resolved path at runtime -- the relative `../../package.json` walk here
 * is identical to what `index.ts` used to compute inline.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function readPackageVersion(): Promise<string> {
  try {
    const packagePath = join(__dirname, '../../package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
    return packageJson.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}
