/**
 * JSON Schema for Favorite (E05-T3)
 * Synchronized with types.ts Favorite interface
 */

import { latLngSchema } from './latlng';

export const favoriteSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'UUID identifier',
    },
    name: {
      type: 'string',
      minLength: 1,
      description: 'Human-readable favorite name (e.g. "Zuhause")',
    },
    latlng: latLngSchema,
    icon: {
      type: 'string',
      minLength: 1,
      description: 'Free-form icon key/emoji shown as the favorite chip icon',
    },
    category: {
      type: 'string',
      enum: ['home', 'campsite', 'poi', 'custom'],
      description: 'Favorite category; "home" may exist at most once',
    },
    sort_order: {
      type: 'number',
      description: 'Drag-order position, ascending',
    },
  },
  required: ['id', 'name', 'latlng', 'icon', 'category', 'sort_order'],
  additionalProperties: false,
} as const;
