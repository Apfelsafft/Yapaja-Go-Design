/**
 * Pure category-filter logic for the POI-Overlay's settings panel (docs/05
 * §6.1: "Marker-Klick -> Detail-Widget -> Settings page with a category
 * filter"). Kept pure/side-effect-free so it is trivially unit-testable
 * without a DOM or the add-on SDK (`filterPois.test.ts`).
 */

import type { CampsitePoi } from './types.js';

/** All distinct category ids present in a POI list, in FIRST-SEEN order
 *  (stable, so the settings panel's checkbox list doesn't reshuffle between
 *  builds of the same bundled dataset). */
export function distinctCategories(pois: readonly CampsitePoi[]): Array<{ id: string; label: string }> {
  const seen = new Map<string, string>();
  for (const poi of pois) {
    if (!seen.has(poi.category)) seen.set(poi.category, poi.categoryLabel);
  }
  return [...seen.entries()].map(([id, label]) => ({ id, label }));
}

/** Filters `pois` down to the ones whose category is in `activeCategories`.
 *  An EMPTY `activeCategories` set means "nothing selected" -> empty result
 *  (not "show everything" -- an explicit, unsurprising empty-filter state
 *  for a settings panel whose checkboxes the user just unchecked one by one). */
export function filterByCategory(
  pois: readonly CampsitePoi[],
  activeCategories: ReadonlySet<string>,
): CampsitePoi[] {
  return pois.filter((poi) => activeCategories.has(poi.category));
}
