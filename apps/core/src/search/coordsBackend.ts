/**
 * `GeocoderBackend` wrapper around the coordinate parser (E05-T1, chain step 1).
 * Pure/no network -- always resolves immediately.
 */
import type { SearchResult } from '@yapaja/shared';
import { parseCoordinates } from './coordinateParser.js';
import type { GeocoderBackend, ReverseQuery, SearchQuery } from './types.js';

export class CoordsBackend implements GeocoderBackend {
  readonly source = 'coords' as const;

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const result = parseCoordinates(query.q);
    return result ? [result] : [];
  }

  // Reverse geocoding is already given lat/lon directly -- coordinate-string
  // parsing doesn't apply, so this backend never contributes to /search/reverse.
  async reverse(_query: ReverseQuery): Promise<SearchResult[]> {
    return [];
  }
}
