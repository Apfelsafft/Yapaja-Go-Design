/**
 * Shared constants for the style documents + transforms.
 */

/** Vector source id used by every Yapaja-served style. */
export const REGION_SOURCE_ID = 'yapaja-region';

/**
 * Placeholder source URL baked into the static style documents. Always
 * rewritten to the active region's real (relative) tile URL before the
 * style is served — see `rewrite.ts`. Kept as an obviously-fake sentinel so
 * a style document that somehow reached a client unrewritten would fail
 * loudly (unresolvable URL) rather than silently pointing at the wrong
 * region.
 */
export const PLACEHOLDER_TILE_URL = 'pmtiles://__YAPAJA_REGION_TILES__';

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
 * A conservative "most relevant for an RV/motorhome trip" POI class
 * allowlist used by the `poi=reduced` density option (and baked into the
 * `yapaja-contrast` style's own default). Kept here (not in options.ts) so
 * both a style's own baseline and the query-option transform can share the
 * same list without importing across "which module owns the default" lines.
 */
export const REDUCED_POI_CLASSES = ['fuel', 'parking', 'campsite', 'supermarket', 'restaurant'];
