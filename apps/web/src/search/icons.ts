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

  // ─── Sonderziele aus dem Offline-Index (0.3.6) ──────────────────────────
  // Die Schluessel sind die OSM-Tag-Werte aus
  // `apps/core/src/search/lite/poiCategories.ts` -- der Lite-Backend setzt
  // `SearchResult.type` auf genau diesen Wert. Fehlt hier einer, faellt er
  // auf 📍 zurueck; das ist haesslich, aber nie kaputt.
  camp_site: '🏕️',
  caravan_site: '🚐',
  charging_station: '🔌',
  toilets: '🚻',
  drinking_water: '🚰',
  sanitary_dump_station: '♻️',
  waste_disposal: '🗑️',
  pharmacy: '💊',
  doctors: '🩺',
  hospital: '🏥',
  veterinary: '🐾',
  restaurant: '🍽️',
  cafe: '☕',
  fast_food: '🍔',
  bank: '🏦',
  atm: '💶',
  post_office: '📮',
  supermarket: '🛒',
  convenience: '🏪',
  bakery: '🥐',
  butcher: '🥩',
  greengrocer: '🥕',
  doityourself: '🔨',
  hardware: '🔧',
  laundry: '🧺',
  gas: '🔥',
  hotel: '🏨',
  guest_house: '🛏️',
  viewpoint: '🔭',
  information: 'ℹ️',
  attraction: '🎡',
  swimming_pool: '🏊',
  sports_centre: '🤸',
  playground: '🛝',
};

export function iconForSearchResultType(type: string): string {
  return TYPE_ICONS[type] ?? '📍';
}
