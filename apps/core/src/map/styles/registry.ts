/**
 * Alle vom Core ausgelieferten Kartenstile (docs/06 §6).
 *
 * Seit 0.3.7 fuenf statt drei -- der Betreiber hat nach einer Auswahl gefragt
 * („Koennen wir eine Auswahl verschiedener Kartenstile anbieten?"). Sie
 * unterscheiden sich in der PALETTE und nicht in der Kartografie: die steht
 * einmal in `baseLayers.ts`. Ein weiterer Stil ist damit eine Palette und ein
 * Eintrag hier, keine zweihundert Zeilen Kopie.
 *
 * Die Oberflaeche listet auf, was hier steht (`GET /api/v1/map/styles`) --
 * ein neuer Stil erscheint im Kartenmenue ohne Aenderung am Frontend.
 */

import { YAPAJA_CONTRAST_STYLE_ID, YAPAJA_CONTRAST_STYLE_NAME, buildYapajaContrastStyle } from './yapaja-contrast.js';
import { YAPAJA_DARK_STYLE_ID, YAPAJA_DARK_STYLE_NAME, buildYapajaDarkStyle } from './yapaja-dark.js';
import { YAPAJA_LIGHT_STYLE_ID, YAPAJA_LIGHT_STYLE_NAME, buildYapajaLightStyle } from './yapaja-light.js';
import { YAPAJA_OUTDOOR_STYLE_ID, YAPAJA_OUTDOOR_STYLE_NAME, buildYapajaOutdoorStyle } from './yapaja-outdoor.js';
import { YAPAJA_MINIMAL_STYLE_ID, YAPAJA_MINIMAL_STYLE_NAME, buildYapajaMinimalStyle } from './yapaja-minimal.js';
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
  { id: YAPAJA_OUTDOOR_STYLE_ID, name: YAPAJA_OUTDOOR_STYLE_NAME, build: buildYapajaOutdoorStyle },
  { id: YAPAJA_CONTRAST_STYLE_ID, name: YAPAJA_CONTRAST_STYLE_NAME, build: buildYapajaContrastStyle },
  { id: YAPAJA_MINIMAL_STYLE_ID, name: YAPAJA_MINIMAL_STYLE_NAME, build: buildYapajaMinimalStyle },
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
