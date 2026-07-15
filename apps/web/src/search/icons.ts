/**
 * Result-type -> icon mapping for the search results list (E05-T2). Plain
 * emoji, same lightweight approach as `ProfileChip`'s 🚐 -- no icon library
 * dependency is added for this task ("keine neuen Dependencies").
 * `SearchResult.type` is a free-form string from Photon/Nominatim/the
 * coordinate parser (`@yapaja/shared`'s `SearchResult['type']` comment:
 * "e.g. city, street, coordinates"), so this is a best-effort lookup with a
 * generic pin fallback for anything not explicitly listed.
 */
const TYPE_ICONS: Record<string, string> = {
  city: '🏙️',
  town: '🏙️',
  village: '🏘️',
  hamlet: '🏘️',
  suburb: '🏘️',
  street: '🛣️',
  house: '🏠',
  building: '🏠',
  coordinates: '📍',
  poi: '📌',
  amenity: '📌',
  campsite: '🏕️',
  fuel: '⛽',
  parking: '🅿️',
};

export function iconForSearchResultType(type: string): string {
  return TYPE_ICONS[type] ?? '📍';
}
