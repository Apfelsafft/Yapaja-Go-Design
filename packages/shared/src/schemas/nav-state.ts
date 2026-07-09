/**
 * JSON Schema for NavState (navigation state machine)
 * Synchronized with types.ts NavState interface
 */

import { latLngSchema } from './latlng';
import { maneuverSchema } from './route';

export const navStateSchema = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['idle', 'routing', 'navigating', 'paused', 'arrived', 'off_route'],
      description: 'Navigation state',
    },
    route_id: {
      type: ['string', 'null'],
      description: 'ID of current route or null',
    },
    next_maneuver: {
      oneOf: [maneuverSchema, { type: 'null' }],
      description: 'Next upcoming maneuver or null',
    },
    distance_to_maneuver_m: {
      type: ['number', 'null'],
      minimum: 0,
      description: 'Distance to next maneuver in meters or null',
    },
    distance_remaining_m: {
      type: ['number', 'null'],
      minimum: 0,
      description: 'Total distance remaining to destination or null',
    },
    duration_remaining_s: {
      type: ['number', 'null'],
      minimum: 0,
      description: 'Estimated time to destination in seconds or null',
    },
    eta: {
      type: ['string', 'null'],
      format: 'date-time',
      description: 'Estimated time of arrival (ISO 8601 local TZ) or null',
    },
    speed_kmh: {
      type: ['number', 'null'],
      minimum: 0,
      description: 'Current speed in km/h or null',
    },
    speed_limit_kmh: {
      type: ['integer', 'null'],
      minimum: 5,
      maximum: 130,
      description: 'Speed limit from map data (5–130 or null for unknown)',
    },
    altitude_m: {
      type: ['number', 'null'],
      description: 'Current altitude in meters above mean sea level or null',
    },
    destination: {
      oneOf: [
        {
          type: 'object',
          properties: {
            latlng: latLngSchema,
            name: {
              type: ['string', 'null'],
              description: 'Destination name or null',
            },
          },
          required: ['latlng', 'name'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
      description: 'Destination with coordinates and optional name or null',
    },
  },
  required: [
    'status',
    'route_id',
    'next_maneuver',
    'distance_to_maneuver_m',
    'distance_remaining_m',
    'duration_remaining_s',
    'eta',
    'speed_kmh',
    'speed_limit_kmh',
    'altitude_m',
    'destination',
  ],
  additionalProperties: false,
} as const;
