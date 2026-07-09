/**
 * JSON Schema for ApiError (unified error format)
 * Synchronized with types.ts ApiError interface
 */

export const apiErrorSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Error code identifier',
        },
        message: {
          type: 'string',
          description: 'Human-readable error message',
        },
        details: {
          type: ['object', 'null'],
          description: 'Optional additional error context',
        },
      },
      required: ['code', 'message'],
      additionalProperties: false,
      description: 'Error object with code, message, and optional details',
    },
  },
  required: ['error'],
  additionalProperties: false,
} as const;
