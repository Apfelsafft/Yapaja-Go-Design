/**
 * JSON Schema for NavInstructionPayload (`nav/instruction` bus/WS topic, E04-T3)
 * Synchronized with types.ts NavInstructionPayload interface
 */

import { maneuverSchema } from './route';

export const navInstructionSchema = {
  type: 'object',
  properties: {
    maneuver: maneuverSchema,
    distance_m: {
      type: 'number',
      minimum: 0,
      description: 'Distance to the maneuver at the moment this instruction fired, in meters',
    },
    say: {
      type: 'string',
      minLength: 1,
      description: 'Natural-language (de-DE) sentence to speak/display',
    },
  },
  required: ['maneuver', 'distance_m', 'say'],
  additionalProperties: false,
} as const;
