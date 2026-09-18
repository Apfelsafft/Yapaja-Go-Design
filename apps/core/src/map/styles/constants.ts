/**
 * Shared constants for the style documents + transforms.
 */

/** Vector source id used by every Yapaia-served style. */
export const REGION_SOURCE_ID = 'yapaja-region';

/**
 * Placeholder source URL baked into the static style documents. Always
 * rewritten to the active region's real (relative) tile URL before the
 * style is served — see `rewrite.ts`. Kept as an obviously-fake sentinel so
 * a style document that somehow reached a client unrewritten would fail
 * loudly (unresolvable URL) rather than silently pointing at the wrong
 * region.
 */
export const PLACEHOLDER_TILE_URL = 'pmtiles://__YAPAIA_REGION_TILES__';

/**
 * Symbol layer ids are how the transforms in `options.ts` classify layers:
 * any `type: 'symbol'` layer is a "label" layer (lang / labelScale apply to
 * it); a symbol layer whose id starts with this prefix is additionally a
 * "POI" layer (the `poi` density option also applies to it). This is a
 * naming convention, not a registry, so future styles/layers opt in simply
 * by following it.
 */
export const POI_LAYER_ID_PREFIX = 'poi';

/**
 * Die POI-Klassen für „reduzierte Dichte" — dieselbe Liste, die auch die
 * Symbole bestimmt.
 *
 * ─── HIER STAND EIN STILLER FEHLER ──────────────────────────────────────────
 * Bis 0.9.0 war das eine eigene Liste:
 *
 *     ['fuel', 'parking', 'campsite', 'supermarket', 'restaurant']
 *
 * `supermarket` gibt es als Klasse NICHT. Das Kachelprofil bildet
 * `supermarket`, `deli`, `department_store`, `greengrocer` und `marketplace`
 * alle auf `grocery` ab (`Poi.java`, `FieldMappings.Class`). Wer „reduzierte
 * POIs" gewählt hatte — und im Stil „Kontrast" ist das die Vorgabe —, bekam
 * also KEINEN einzigen Supermarkt zu sehen, obwohl die Einstellung genau das
 * versprach. Nichts schlug fehl, nichts stand im Protokoll.
 *
 * Eine zweite, von Hand gepflegte Liste kann immer von der ersten abweichen.
 * Deshalb ist es jetzt DIESELBE: was ein Symbol hat, ist auch das, was
 * „reduziert" übrig lässt.
 */
export { POI_KLASSEN_MIT_SYMBOL as REDUCED_POI_CLASSES } from '@yapaia/shared';
