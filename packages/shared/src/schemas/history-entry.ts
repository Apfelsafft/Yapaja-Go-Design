/**
 * JSON Schema for HistoryEntry (E05-T3)
 * Synchronized with types.ts HistoryEntry interface.
 *
 * Structural validation only -- the "at least one of query/destination is
 * non-null" business rule is enforced by the Core's history routes/service,
 * not expressible cleanly here without weakening `additionalProperties`.
 */

import { latLngSchema } from './latlng';

export const historyEntrySchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'UUID identifier',
    },
    query: {
      type: ['string', 'null'],
      description: 'Raw search query text, or null if this entry is a picked destination',
    },
    destination: {
      type: ['object', 'null'],
      properties: {
        latlng: latLngSchema,
        name: { type: ['string', 'null'] },
      },
      required: ['latlng', 'name'],
      additionalProperties: false,
      description: 'Picked destination, or null if this entry is a raw search query',
    },
    ts: {
      type: 'string',
      description: 'ISO 8601 UTC timestamp',
    },
  },
  required: ['id', 'query', 'destination', 'ts'],
  additionalProperties: false,
} as const;
