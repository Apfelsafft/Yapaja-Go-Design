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

import { YAPAIA_CONTRAST_STYLE_ID, YAPAIA_CONTRAST_STYLE_NAME, buildYapaiaContrastStyle } from './yapaja-contrast.js';
import { YAPAIA_DARK_STYLE_ID, YAPAIA_DARK_STYLE_NAME, buildYapaiaDarkStyle } from './yapaja-dark.js';
import { YAPAIA_LIGHT_STYLE_ID, YAPAIA_LIGHT_STYLE_NAME, buildYapaiaLightStyle } from './yapaja-light.js';
import { YAPAIA_OUTDOOR_STYLE_ID, YAPAIA_OUTDOOR_STYLE_NAME, buildYapaiaOutdoorStyle } from './yapaja-outdoor.js';
import { YAPAIA_MINIMAL_STYLE_ID, YAPAIA_MINIMAL_STYLE_NAME, buildYapaiaMinimalStyle } from './yapaja-minimal.js';
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
  { id: YAPAIA_LIGHT_STYLE_ID, name: YAPAIA_LIGHT_STYLE_NAME, build: buildYapaiaLightStyle },
  { id: YAPAIA_DARK_STYLE_ID, name: YAPAIA_DARK_STYLE_NAME, build: buildYapaiaDarkStyle },
  { id: YAPAIA_OUTDOOR_STYLE_ID, name: YAPAIA_OUTDOOR_STYLE_NAME, build: buildYapaiaOutdoorStyle },
  { id: YAPAIA_CONTRAST_STYLE_ID, name: YAPAIA_CONTRAST_STYLE_NAME, build: buildYapaiaContrastStyle },
  { id: YAPAIA_MINIMAL_STYLE_ID, name: YAPAIA_MINIMAL_STYLE_NAME, build: buildYapaiaMinimalStyle },
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
