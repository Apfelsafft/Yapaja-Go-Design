/**
 * E10-T5 (docs/07 §7, docs/03 §1): OpenAPI `components.schemas`, built
 * directly from the SAME JSON-Schema objects `@yapaja/shared` exports for
 * runtime AJV validation (`packages/shared/src/schemas/*`) -- imported, not
 * copied. docs/03-api-spec.md §1 names these schemas the intended "Single
 * Source of Truth" that "generate[s] ... OpenAPI-Doku"; this module is that
 * generation step.
 *
 * OpenAPI version choice: 3.1.0. These schemas use plain JSON Schema
 * (2020-12-compatible) constructs -- e.g. `type: ['object', 'null']` in
 * `apiErrorSchema`'s `details` field -- that OpenAPI 3.0's stricter dialect
 * doesn't accept without rewriting (`nullable: true` etc). OpenAPI 3.1
 * aligns its schema dialect with JSON Schema, so every shared schema embeds
 * unmodified below -- no lossy translation, no risk of the published spec
 * silently drifting from what the code actually validates against.
 */

import {
  latLngSchema,
  positionSchema,
  vehicleProfileSchema,
  routeRequestSchema,
  routeSchema,
  maneuverSchema,
  navStateSchema,
  navInstructionSchema,
  apiErrorSchema,
  searchResultSchema,
  favoriteSchema,
  historyEntrySchema,
  addonManifestSchema,
} from '@yapaja/shared';

/** Component-schema name -> the real `@yapaja/shared` JSON Schema object. */
export const COMPONENT_SCHEMAS: Record<string, unknown> = {
  LatLng: latLngSchema,
  Position: positionSchema,
  VehicleProfile: vehicleProfileSchema,
  RouteRequest: routeRequestSchema,
  Route: routeSchema,
  Maneuver: maneuverSchema,
  NavState: navStateSchema,
  NavInstruction: navInstructionSchema,
  ApiError: apiErrorSchema,
  SearchResult: searchResultSchema,
  Favorite: favoriteSchema,
  HistoryEntry: historyEntrySchema,
  AddonManifest: addonManifestSchema,
};
