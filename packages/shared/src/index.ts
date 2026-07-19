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
  NavInstructionPayload,
  ApiError,
  SearchResult,
  Favorite,
  HistoryEntry,
  AddonManifest,
  AddonManifestUi,
  AddonManifestWidget,
  AddonManifestMapLayer,
  AddonManifestService,
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
export { navInstructionSchema } from './schemas/nav-instruction';
export { apiErrorSchema } from './schemas/api-error';
export { searchResultSchema } from './schemas/search-result';
export { favoriteSchema } from './schemas/favorite';
export { historyEntrySchema } from './schemas/history-entry';
export {
  addonManifestSchema,
  addonManifestUiSchema,
  addonManifestServiceSchema,
  addonManifestWidgetSchema,
  addonManifestMapLayerSchema,
  ADDON_ID_PATTERN,
  ADDON_PERMISSION_SCOPES,
  ADDON_NET_FETCH_PATTERN,
} from './schemas/addon-manifest';

// Validators (type guards)
export {
  validateLatLng,
  validatePosition,
  validateVehicleProfile,
  validateRouteRequest,
  validateRoute,
  validateManeuver,
  validateNavState,
  validateNavInstruction,
  validateApiError,
  validateSearchResult,
  validateFavorite,
  validateHistoryEntry,
  getValidationErrorsLatLng,
  getValidationErrorsPosition,
  getValidationErrorsVehicleProfile,
  getValidationErrorsRouteRequest,
  getValidationErrorsRoute,
  getValidationErrorsManeuver,
  getValidationErrorsNavState,
  getValidationErrorsNavInstruction,
  getValidationErrorsApiError,
  getValidationErrorsSearchResult,
  getValidationErrorsFavorite,
  getValidationErrorsHistoryEntry,
  validateAddonManifest,
  getValidationErrorsAddonManifest,
} from './validators';

// Semver helpers (E09-T1, docs/05 §2/§3): validate/compare `version` and
// `core_api` range strings from the add-on manifest.
export { isValidSemver, isValidRange, satisfies, compareVersions } from './semver';

// Plausibility checks
export {
  checkPosition,
  checkNavState,
  checkRoute,
  type PlausibilityResult,
} from './plausibility';

// Utilities
export { formatDistance } from './utils';
export { formatEta, type FormatEtaOptions } from './formatEta';

// Sun position (E07-T3): offline sunrise/sunset, NOAA-derived, pure.
export {
  computeSunTimes,
  type SunTimes,
  type SunTimesNormal,
  type SunTimesPolarNight,
  type SunTimesMidnightSun,
} from './sun';
