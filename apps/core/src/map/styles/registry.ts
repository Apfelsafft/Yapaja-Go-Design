/**
 * Registry of all core-served styles (docs/06-ui-ux-guidelines.md §6):
 * `Yapaja Light`, `Yapaja Dark`, `Yapaja Contrast`. Add-on styles are out of
 * scope for this task; this registry is the single place a future add-on
 * mechanism would extend.
 */

import { YAPAJA_CONTRAST_STYLE_ID, YAPAJA_CONTRAST_STYLE_NAME, buildYapajaContrastStyle } from './yapaja-contrast.js';
import { YAPAJA_DARK_STYLE_ID, YAPAJA_DARK_STYLE_NAME, buildYapajaDarkStyle } from './yapaja-dark.js';
import { YAPAJA_LIGHT_STYLE_ID, YAPAJA_LIGHT_STYLE_NAME, buildYapajaLightStyle } from './yapaja-light.js';
import type { MapStyleDocument } from './types.js';

export interface StyleSummary {
  id: string;
  name: string;
  preview?: string;
}

interface StyleRegistryEntry extends StyleSummary {
  build: () => MapStyleDocument;
}

const STYLE_REGISTRY: StyleRegistryEntry[] = [
  { id: YAPAJA_LIGHT_STYLE_ID, name: YAPAJA_LIGHT_STYLE_NAME, build: buildYapajaLightStyle },
  { id: YAPAJA_DARK_STYLE_ID, name: YAPAJA_DARK_STYLE_NAME, build: buildYapajaDarkStyle },
  { id: YAPAJA_CONTRAST_STYLE_ID, name: YAPAJA_CONTRAST_STYLE_NAME, build: buildYapajaContrastStyle },
];

/** Lists all available styles for `GET /api/v1/map/styles` (`{id, name}[]`). */
export function listStyleSummaries(): StyleSummary[] {
  return STYLE_REGISTRY.map(({ id, name, preview }) => ({ id, name, ...(preview ? { preview } : {}) }));
}

/** Builds a fresh style document by id, or null if the id is unknown. A
 *  fresh build (not a shared/cached object) is returned every time so
 *  callers can freely mutate it (e.g. `rewriteSourceUrls`, `applyStyleOptions`)
 *  without one request's transforms leaking into another's. */
export function getStyleDocument(id: string): MapStyleDocument | null {
  const entry = STYLE_REGISTRY.find((candidate) => candidate.id === id);
  return entry ? entry.build() : null;
}
