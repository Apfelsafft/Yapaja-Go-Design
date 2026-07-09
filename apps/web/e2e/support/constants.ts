/**
 * Shared constants for the Playwright harness (ports, paths, fixture region
 * name). Kept as plain data so both `playwright.config.ts` and the spec
 * files can import it without duplicating magic numbers.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// apps/web/e2e/support -> apps/web
export const WEB_ROOT = join(__dirname, '..', '..');
// apps/web -> apps -> <repo root>
export const REPO_ROOT = join(WEB_ROOT, '..', '..');
export const CORE_ROOT = join(REPO_ROOT, 'apps', 'core');
export const CORE_DIST_INDEX = join(CORE_ROOT, 'dist', 'index.js');
export const CORE_PUBLIC_DIR = join(CORE_ROOT, 'public');
export const WEB_DIST_DIR = join(WEB_ROOT, 'dist');

export const FIXTURE_REGION = 'fixture';
export const FIXTURE_TILES_DIR = join(WEB_ROOT, 'e2e', '.tmp', 'tiles-fixture');
export const EMPTY_TILES_DIR = join(WEB_ROOT, 'e2e', '.tmp', 'tiles-empty');

// Fixed, uncommon ports so parallel local dev servers (vite :5173, core :8080)
// never collide with the e2e harness.
export const CORE_PORT = 4310;
export const EMPTY_CORE_PORT = 4311;
export const SUBPATH_PORT = 4312;
export const SUBPATH_PREFIX = '/rv-demo';

export const CORE_BASE_URL = `http://127.0.0.1:${CORE_PORT}`;
export const EMPTY_CORE_BASE_URL = `http://127.0.0.1:${EMPTY_CORE_PORT}`;
export const SUBPATH_BASE_URL = `http://127.0.0.1:${SUBPATH_PORT}`;
