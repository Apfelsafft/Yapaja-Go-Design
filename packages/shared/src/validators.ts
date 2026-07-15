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
import { apiErrorSchema } from './schemas/api-error';
import { searchResultSchema } from './schemas/search-result';

import type {
  LatLng,
  Position,
  VehicleProfile,
  RouteRequest,
  Route,
  Maneuver,
  NavState,
  ApiError,
  SearchResult,
} from './types';

// Initialize AJV with formats
const ajv = new Ajv({ allErrors: true, strictSchema: false });
addFormats(ajv);

// Compile validators
const validateLatLngImpl = ajv.compile(latLngSchema);
const validatePositionImpl = ajv.compile(positionSchema);
const validateVehicleProfileImpl = ajv.compile(vehicleProfileSchema);
const validateRouteRequestImpl = ajv.compile(routeRequestSchema);
const validateRouteImpl = ajv.compile(routeSchema);
const validateManeuverImpl = ajv.compile(maneuverSchema);
const validateNavStateImpl = ajv.compile(navStateSchema);
const validateApiErrorImpl = ajv.compile(apiErrorSchema);
const validateSearchResultImpl = ajv.compile(searchResultSchema);

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
