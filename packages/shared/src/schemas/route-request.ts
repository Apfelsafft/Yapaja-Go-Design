/**
 * JSON Schema for RouteRequest
 * Synchronized with types.ts RouteRequest interface
 */

import { latLngSchema } from './latlng';

export const routeRequestSchema = {
  type: 'object',
  properties: {
    origin: {
      oneOf: [
        latLngSchema,
        {
          type: 'string',
          enum: ['current'],
        },
      ],
      description: 'Starting point: LatLng or "current" for device position',
    },
    destination: latLngSchema,
    waypoints: {
      type: 'array',
      items: latLngSchema,
      maxItems: 25,
      description: 'Intermediate waypoints (max 25)',
    },
    profile_id: {
      type: 'string',
      description: 'UUID of vehicle profile to use',
    },
    alternatives: {
      type: 'integer',
      minimum: 0,
      maximum: 3,
      description: 'Number of alternative routes to return (0–3)',
    },
  },
  required: ['origin', 'destination', 'waypoints', 'profile_id', 'alternatives'],
  additionalProperties: false,
} as const;
