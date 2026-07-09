/**
 * JSON Schema for Route and related types (Maneuver, SpeedSegment, etc.)
 * Synchronized with types.ts Route and Maneuver interfaces
 */

export const laneInfoSchema = {
  type: 'object',
  properties: {
    lane_index: {
      type: 'integer',
      minimum: 0,
      description: 'Lane index from left',
    },
    is_usable: {
      type: 'boolean',
      description: 'Whether vehicle can use this lane',
    },
    direction: {
      type: ['string', 'null'],
      description: 'Direction indicator if available',
    },
  },
  required: ['lane_index', 'is_usable'],
  additionalProperties: false,
} as const;

export const speedSegmentSchema = {
  type: 'object',
  properties: {
    begin_shape_index: {
      type: 'integer',
      minimum: 0,
      description: 'Start index in route geometry',
    },
    end_shape_index: {
      type: 'integer',
      minimum: 0,
      description: 'End index in route geometry',
    },
    kmh: {
      type: ['integer', 'null'],
      minimum: 5,
      maximum: 130,
      description: 'Speed limit in km/h (5–130 or null for unknown)',
    },
  },
  required: ['begin_shape_index', 'end_shape_index', 'kmh'],
  additionalProperties: false,
} as const;

export const routeWarningSchema = {
  type: 'object',
  properties: {
    code: {
      type: 'string',
      description: 'Warning code identifier',
    },
    message: {
      type: 'string',
      description: 'Human-readable warning message',
    },
  },
  required: ['code', 'message'],
  additionalProperties: false,
} as const;

export const routeLegSchema = {
  type: 'object',
  properties: {
    index: {
      type: 'integer',
      minimum: 0,
      description: 'Leg index',
    },
    distance_m: {
      type: 'number',
      minimum: 0,
      description: 'Leg distance in meters',
    },
    duration_s: {
      type: 'number',
      minimum: 0,
      description: 'Leg duration in seconds',
    },
  },
  required: ['index', 'distance_m', 'duration_s'],
  additionalProperties: false,
} as const;

export const maneuverSchema = {
  type: 'object',
  properties: {
    index: {
      type: 'integer',
      minimum: 0,
      description: 'Maneuver index in route',
    },
    type: {
      type: 'string',
      description: 'Maneuver type (Valhalla enum, e.g. "turn_left", "roundabout_enter")',
    },
    instruction: {
      type: 'string',
      description: 'Localized instruction text',
    },
    street_names: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Names of streets involved',
    },
    distance_m: {
      type: 'number',
      minimum: 0,
      description: 'Length of maneuver segment in meters',
    },
    begin_shape_index: {
      type: 'integer',
      minimum: 0,
      description: 'Start index in route geometry',
    },
    lanes: {
      type: ['array', 'null'],
      items: laneInfoSchema,
      description: 'Optional lane information',
    },
  },
  required: ['index', 'type', 'instruction', 'street_names', 'distance_m', 'begin_shape_index'],
  additionalProperties: false,
} as const;

export const routeSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'Route identifier',
    },
    distance_m: {
      type: 'number',
      minimum: 0,
      description: 'Total route distance in meters',
    },
    duration_s: {
      type: 'number',
      minimum: 0,
      description: 'Total route duration in seconds (Valhalla time, calibrated)',
    },
    geometry: {
      type: 'string',
      description: 'Encoded polyline (polyline6 format)',
    },
    legs: {
      type: 'array',
      items: routeLegSchema,
      description: 'Route segments between waypoints',
    },
    maneuvers: {
      type: 'array',
      items: maneuverSchema,
      description: 'Turn-by-turn instructions',
    },
    speed_limits: {
      type: 'array',
      items: speedSegmentSchema,
      description: 'Speed restrictions along route',
    },
    warnings: {
      type: 'array',
      items: routeWarningSchema,
      description: 'Route warnings (e.g. "restriction data missing")',
    },
  },
  required: ['id', 'distance_m', 'duration_s', 'geometry', 'legs', 'maneuvers', 'speed_limits', 'warnings'],
  additionalProperties: false,
} as const;
