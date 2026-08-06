/**
 * AJV-based JSON Schema validators for all core types
 * Exports type guards and validation error helpers
 */

import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

import { latLngSchema } from './schemas/latlng';
import { positionSchema } from './schemas/position';
import { vehicleProfileSchema } from './schemas/vehicle-profile';
import { routeRequestSchema } from './schemas/route-request';
import { routeSchema, maneuverSchema } from './schemas/route';
import { navStateSchema } from './schemas/nav-state';
import { navInstructionSchema } from './schemas/nav-instruction';
import { apiErrorSchema } from './schemas/api-error';
import { searchResultSchema } from './schemas/search-result';
import { favoriteSchema } from './schemas/favorite';
import { historyEntrySchema } from './schemas/history-entry';
import { addonManifestSchema } from './schemas/addon-manifest';
import { isValidSemver, isValidRange } from './semver';

import type {
  LatLng,
  Position,
  VehicleProfile,
  RouteRequest,
  Route,
  Maneuver,
  NavState,
  NavInstructionPayload,
  ApiError,
  SearchResult,
  Favorite,
  HistoryEntry,
  AddonManifest,
} from './types';

// Initialize AJV with formats
const ajv = new Ajv({ allErrors: true, strictSchema: false });
addFormats(ajv);

/**
 * LAZY schema compilation (E10-T4).
 *
 * `ajv.compile()` generates JavaScript at runtime and evaluates it with
 * `new Function()`. Doing that at MODULE LOAD meant that merely importing
 * anything from `@yapaja/shared` -- even `formatEta` -- executed thirteen
 * `new Function()` calls as a side effect of the barrel export.
 *
 * In Node that is invisible. In a browser under the Core's
 * `Content-Security-Policy: script-src 'self'` (E10-T4,
 * `apps/core/src/security/headers.ts`) it is fatal: the CSP refuses to
 * evaluate the generated string, the import throws, and the whole web app
 * fails to boot -- observed as a blank page with no map canvas.
 *
 * This is the SAME failure mode E09-T4 already hit once, when
 * `packages/addon-sdk/src/version.ts` imported `isValidSemver` from this
 * package and thereby died under the add-on CSP. There the fix was to stop
 * importing the barrel; here it is fixed at the source, so no future
 * consumer can trip over it again.
 *
 * Compiling on FIRST USE keeps the public API byte-identical (every
 * `validateX(data)` still works exactly as before, and the Core -- which
 * does call them -- pays the same one-off cost, just slightly later), while
 * a browser that never validates never evaluates anything.
 */
function lazyValidator(schema: object): ValidateFunction {
  let compiled: ValidateFunction | null = null;
  // Typed as a `ValidateFunction` because callers legitimately read AJV's
  // `.errors` after a failed call (`getValidationErrorsForValidator` below).
  // The wrapper therefore FORWARDS `.errors` from the real compiled
  // validator after every call, so the lazy version is observationally
  // identical to the eager one.
  const wrapper = ((data: unknown): boolean => {
    if (compiled === null) compiled = ajv.compile(schema);
    const ok = compiled(data) as boolean;
    wrapper.errors = compiled.errors;
    return ok;
  }) as ValidateFunction;
  return wrapper;
}

// Compile validators
const validateLatLngImpl = lazyValidator(latLngSchema);
const validatePositionImpl = lazyValidator(positionSchema);
const validateVehicleProfileImpl = lazyValidator(vehicleProfileSchema);
const validateRouteRequestImpl = lazyValidator(routeRequestSchema);
const validateRouteImpl = lazyValidator(routeSchema);
const validateManeuverImpl = lazyValidator(maneuverSchema);
const validateNavStateImpl = lazyValidator(navStateSchema);
const validateNavInstructionImpl = lazyValidator(navInstructionSchema);
const validateApiErrorImpl = lazyValidator(apiErrorSchema);
const validateSearchResultImpl = lazyValidator(searchResultSchema);
const validateFavoriteImpl = lazyValidator(favoriteSchema);
const validateHistoryEntryImpl = lazyValidator(historyEntrySchema);
const validateAddonManifestStructuralImpl = lazyValidator(addonManifestSchema);

/**
 * Type guard for LatLng
 */
export function validateLatLng(data: unknown): data is LatLng {
  return validateLatLngImpl(data);
}

/**
 * Type guard for Position
 */
export function validatePosition(data: unknown): data is Position {
  return validatePositionImpl(data);
}

/**
 * Type guard for VehicleProfile
 */
export function validateVehicleProfile(data: unknown): data is VehicleProfile {
  return validateVehicleProfileImpl(data);
}

/**
 * Type guard for RouteRequest
 */
export function validateRouteRequest(data: unknown): data is RouteRequest {
  return validateRouteRequestImpl(data);
}

/**
 * Type guard for Route
 */
export function validateRoute(data: unknown): data is Route {
  return validateRouteImpl(data);
}

/**
 * Type guard for Maneuver
 */
export function validateManeuver(data: unknown): data is Maneuver {
  return validateManeuverImpl(data);
}

/**
 * Type guard for NavState
 */
export function validateNavState(data: unknown): data is NavState {
  return validateNavStateImpl(data);
}

/**
 * Type guard for NavInstructionPayload
 */
export function validateNavInstruction(data: unknown): data is NavInstructionPayload {
  return validateNavInstructionImpl(data);
}

/**
 * Type guard for ApiError
 */
export function validateApiError(data: unknown): data is ApiError {
  return validateApiErrorImpl(data);
}

/**
 * Type guard for SearchResult
 */
export function validateSearchResult(data: unknown): data is SearchResult {
  return validateSearchResultImpl(data);
}

/**
 * Type guard for Favorite
 */
export function validateFavorite(data: unknown): data is Favorite {
  return validateFavoriteImpl(data);
}

/**
 * Type guard for HistoryEntry
 */
export function validateHistoryEntry(data: unknown): data is HistoryEntry {
  return validateHistoryEntryImpl(data);
}

/**
 * Get all validation errors for a given type and data
 * @param typeName Name of the type for error messages
 * @param data Data to validate
 * @param validator Compiled AJV validator function
 * @returns Array of human-readable error messages
 */
function getValidationErrorsForValidator(
  typeName: string,
  data: unknown,
  validator: ValidateFunction,
): string[] {
  const errors: string[] = [];
  if (!validator(data) && validator.errors) {
    for (const error of validator.errors) {
      const path = error.instancePath || '/';
      const field = path === '/' ? 'root' : path.substring(1);
      errors.push(
        `${typeName}[${field}]: ${error.message}` +
          (error.params ? ` (${JSON.stringify(error.params)})` : ''),
      );
    }
  }
  return errors;
}

/**
 * Get validation errors for LatLng
 */
export function getValidationErrorsLatLng(data: unknown): string[] {
  return getValidationErrorsForValidator('LatLng', data, validateLatLngImpl);
}

/**
 * Get validation errors for Position
 */
export function getValidationErrorsPosition(data: unknown): string[] {
  return getValidationErrorsForValidator('Position', data, validatePositionImpl);
}

/**
 * Get validation errors for VehicleProfile
 */
export function getValidationErrorsVehicleProfile(data: unknown): string[] {
  return getValidationErrorsForValidator('VehicleProfile', data, validateVehicleProfileImpl);
}

/**
 * Get validation errors for RouteRequest
 */
export function getValidationErrorsRouteRequest(data: unknown): string[] {
  return getValidationErrorsForValidator('RouteRequest', data, validateRouteRequestImpl);
}

/**
 * Get validation errors for Route
 */
export function getValidationErrorsRoute(data: unknown): string[] {
  return getValidationErrorsForValidator('Route', data, validateRouteImpl);
}

/**
 * Get validation errors for Maneuver
 */
export function getValidationErrorsManeuver(data: unknown): string[] {
  return getValidationErrorsForValidator('Maneuver', data, validateManeuverImpl);
}

/**
 * Get validation errors for NavState
 */
export function getValidationErrorsNavState(data: unknown): string[] {
  return getValidationErrorsForValidator('NavState', data, validateNavStateImpl);
}

/**
 * Get validation errors for NavInstructionPayload
 */
export function getValidationErrorsNavInstruction(data: unknown): string[] {
  return getValidationErrorsForValidator('NavInstructionPayload', data, validateNavInstructionImpl);
}

/**
 * Get validation errors for ApiError
 */
export function getValidationErrorsApiError(data: unknown): string[] {
  return getValidationErrorsForValidator('ApiError', data, validateApiErrorImpl);
}

/**
 * Get validation errors for SearchResult
 */
export function getValidationErrorsSearchResult(data: unknown): string[] {
  return getValidationErrorsForValidator('SearchResult', data, validateSearchResultImpl);
}

/**
 * Get validation errors for Favorite
 */
export function getValidationErrorsFavorite(data: unknown): string[] {
  return getValidationErrorsForValidator('Favorite', data, validateFavoriteImpl);
}

/**
 * Get validation errors for HistoryEntry
 */
export function getValidationErrorsHistoryEntry(data: unknown): string[] {
  return getValidationErrorsForValidator('HistoryEntry', data, validateHistoryEntryImpl);
}

/**
 * Add-on manifest (`yapaja-addon.json`, E09-T1) validation: layers the
 * hand-rolled semver checks (`isValidSemver`/`isValidRange`, `./semver.ts`)
 * on top of the AJV structural schema, since AJV alone can't express "is
 * this a valid semver range". Both layers must pass. The semver checks only
 * run once the structural schema has already confirmed `version`/`core_api`
 * are non-empty strings, so they never see the wrong type.
 */
function addonManifestSemverErrors(data: unknown): string[] {
  const errors: string[] = [];
  const obj = data as Partial<AddonManifest>;
  if (typeof obj?.version === 'string' && !isValidSemver(obj.version)) {
    errors.push(`AddonManifest[version]: "${obj.version}" is not a valid semver version`);
  }
  if (typeof obj?.core_api === 'string' && !isValidRange(obj.core_api)) {
    errors.push(`AddonManifest[core_api]: "${obj.core_api}" is not a valid semver range`);
  }
  return errors;
}

/**
 * Type guard for AddonManifest (structural + semver validity).
 */
export function validateAddonManifest(data: unknown): data is AddonManifest {
  return validateAddonManifestStructuralImpl(data) && addonManifestSemverErrors(data).length === 0;
}

/**
 * Get validation errors for AddonManifest (structural AJV errors first,
 * then semver-specific errors if the structural pass succeeded).
 */
export function getValidationErrorsAddonManifest(data: unknown): string[] {
  const structuralErrors = getValidationErrorsForValidator(
    'AddonManifest',
    data,
    validateAddonManifestStructuralImpl,
  );
  if (structuralErrors.length > 0) return structuralErrors;
  return addonManifestSemverErrors(data);
}
