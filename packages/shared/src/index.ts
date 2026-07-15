// Types
export type {
  LatLng,
  Position,
  VehicleProfile,
  RouteRequest,
  RouteAvoidOverrides,
  RouteLeg,
  SpeedSegment,
  LaneInfo,
  RouteWarning,
  Maneuver,
  ManeuverType,
  Route,
  NavState,
  ApiError,
  SearchResult,
} from './types';

// Schemas (as const for validation)
export { latLngSchema } from './schemas/latlng';
export { positionSchema } from './schemas/position';
export { vehicleProfileSchema } from './schemas/vehicle-profile';
export { routeRequestSchema } from './schemas/route-request';
export {
  laneInfoSchema,
  speedSegmentSchema,
  routeWarningSchema,
  routeLegSchema,
  maneuverSchema,
  routeSchema,
} from './schemas/route';
export { navStateSchema } from './schemas/nav-state';
export { apiErrorSchema } from './schemas/api-error';
export { searchResultSchema } from './schemas/search-result';

// Validators (type guards)
export {
  validateLatLng,
  validatePosition,
  validateVehicleProfile,
  validateRouteRequest,
  validateRoute,
  validateManeuver,
  validateNavState,
  validateApiError,
  validateSearchResult,
  getValidationErrorsLatLng,
  getValidationErrorsPosition,
  getValidationErrorsVehicleProfile,
  getValidationErrorsRouteRequest,
  getValidationErrorsRoute,
  getValidationErrorsManeuver,
  getValidationErrorsNavState,
  getValidationErrorsApiError,
  getValidationErrorsSearchResult,
} from './validators';

// Plausibility checks
export {
  checkPosition,
  checkNavState,
  checkRoute,
  type PlausibilityResult,
} from './plausibility';

// Utilities
export { formatDistance } from './utils';
