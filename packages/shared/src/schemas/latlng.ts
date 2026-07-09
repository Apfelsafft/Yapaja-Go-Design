/**
 * JSON Schema for LatLng (WGS84 coordinates)
 * Synchronized with types.ts LatLng interface
 */

export const latLngSchema = {
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
  },
  required: ['lat', 'lon'],
  additionalProperties: false,
} as const;
