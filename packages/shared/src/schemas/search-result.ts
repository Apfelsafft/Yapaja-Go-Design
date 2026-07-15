/**
 * JSON Schema for SearchResult (E05-T1)
 * Synchronized with types.ts SearchResult interface
 */

import { latLngSchema } from './latlng';

export const searchResultSchema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Short name of the result (e.g. "Vaduz")',
    },
    label: {
      type: 'string',
      description: 'Full display label (e.g. "Vaduz, Liechtenstein")',
    },
    latlng: latLngSchema,
    type: {
      type: 'string',
      description: 'Result category (e.g. "city", "street", "coordinates")',
    },
    source: {
      type: 'string',
      enum: ['photon', 'nominatim', 'coords', 'lite'],
      description:
        'Backend that produced this result; "lite" = offline SQLite/FTS5 fallback used when Photon is down/disabled (E05-T5, W-12)',
    },
    out_of_coverage: {
      type: 'boolean',
      description:
        'True if the result lies outside all installed map regions (Vorgriff W-09)',
    },
  },
  required: ['name', 'label', 'latlng', 'type', 'source'],
  additionalProperties: false,
} as const;
