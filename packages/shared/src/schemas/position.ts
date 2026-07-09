/**
 * JSON Schema for Position with GPS metadata
 * Synchronized with types.ts Position interface
 */

export const positionSchema = {
  type: 'object',
  properties: {
    lat: {
      type: 'number',
      minimum: -90,
      maximum: 90,
      description: 'Latitude in degrees (-90 to 90)',
    },
    lon: {
      type: 'number',
      minimum: -180,
      maximum: 180,
      description: 'Longitude in degrees (-180 to 180)',
    },
    alt: {
      type: ['number', 'null'],
      description: 'Altitude in meters above mean sea level',
    },
    speed: {
      type: ['number', 'null'],
      minimum: 0,
      description: 'Speed in m/s over ground',
    },
    heading: {
      type: ['number', 'null'],
      minimum: 0,
      maximum: 360,
      description: 'Heading in degrees (0 = North)',
    },
    accuracy: {
      type: ['number', 'null'],
      minimum: 0,
      description: 'Horizontal accuracy in meters (HDOP-based)',
    },
    source: {
      type: 'string',
      enum: ['gpsd', 'browser', 'simulator'],
      description: 'Source of position data',
    },
    fix: {
      type: 'string',
      enum: ['none', '2d', '3d'],
      description: 'GPS fix type',
    },
    ts: {
      type: 'string',
      format: 'date-time',
      description: 'Timestamp in ISO 8601 UTC',
    },
  },
  required: ['lat', 'lon', 'alt', 'speed', 'heading', 'accuracy', 'source', 'fix', 'ts'],
  additionalProperties: false,
} as const;
