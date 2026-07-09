/**
 * JSON Schema for VehicleProfile
 * Synchronized with types.ts VehicleProfile interface
 */

export const vehicleProfileSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'UUID identifier',
    },
    name: {
      type: 'string',
      minLength: 1,
      description: 'Human-readable profile name (e.g. "Kastenwagen")',
    },
    height_m: {
      type: 'number',
      minimum: 1.0,
      maximum: 4.5,
      description: 'Height in meters (1.0–4.5)',
    },
    width_m: {
      type: 'number',
      minimum: 1.5,
      maximum: 3.0,
      description: 'Width in meters (1.5–3.0)',
    },
    length_m: {
      type: 'number',
      minimum: 3.0,
      maximum: 20.0,
      description: 'Length in meters (3.0–20.0)',
    },
    weight_t: {
      type: 'number',
      minimum: 1.0,
      maximum: 40.0,
      description: 'Weight in metric tons (1.0–40.0)',
    },
    avg_speed_kmh: {
      type: 'number',
      minimum: 40,
      maximum: 130,
      description: 'Average speed in km/h for ETA calculation (40–130)',
    },
    hazmat: {
      type: 'boolean',
      description: 'Whether vehicle carries hazardous materials',
    },
    avoid: {
      type: 'object',
      properties: {
        motorway: { type: 'boolean' },
        toll: { type: 'boolean' },
        ferry: { type: 'boolean' },
        unpaved: { type: 'boolean' },
      },
      required: ['motorway', 'toll', 'ferry', 'unpaved'],
      additionalProperties: false,
      description: 'Route restriction preferences',
    },
    is_active: {
      type: 'boolean',
      description: 'Whether this profile is currently active',
    },
  },
  required: ['id', 'name', 'height_m', 'width_m', 'length_m', 'weight_t', 'avg_speed_kmh', 'hazmat', 'avoid', 'is_active'],
  additionalProperties: false,
} as const;
