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
    // E03-T4: optional, backward-compatible temporary-avoidance fields.
    // Absent in a request => identical behavior to before this schema
    // version (no exclusions, no avoid overrides).
    exclude_locations: {
      type: 'array',
      items: latLngSchema,
      description:
        'Optional point locations to exclude from routing for this request only (temporary avoidance, not persisted)',
    },
    exclude_polygons: {
      type: 'array',
      items: {
        type: 'array',
        items: latLngSchema,
        minItems: 3,
        description: 'Closed ring of LatLng points forming a polygon to exclude',
      },
      description:
        'Optional polygons to exclude from routing for this request only (temporary avoidance, not persisted)',
    },
    avoid_overrides: {
      type: 'object',
      properties: {
        motorway: { type: 'boolean' },
        toll: { type: 'boolean' },
        ferry: { type: 'boolean' },
        unpaved: { type: 'boolean' },
      },
      additionalProperties: false,
      description:
        'Optional per-request overrides of the active profile\'s avoid flags; the profile itself is not modified',
    },
  },
  required: ['origin', 'destination', 'waypoints', 'profile_id', 'alternatives'],
  additionalProperties: false,
} as const;
