/**
 * Shared types for the POI-Overlay reference add-on (E09-T5, docs/05 §6.1).
 * Kept dependency-free (no `@yapaja/*` imports) so `filterPois.ts`/`geo.ts`
 * stay trivially unit-testable without pulling in the SDK.
 */

export interface CampsitePoi {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  pricePerNightEur: number;
  amenities: string[];
  description: string;
  lat: number;
  lng: number;
}

export interface CampsiteGeoJson {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: {
      id: string;
      name: string;
      category: string;
      categoryLabel: string;
      pricePerNightEur: number;
      amenities: string[];
      description: string;
    };
  }>;
}

/** Flattens the bundled GeoJSON FeatureCollection into the flat `CampsitePoi`
 *  shape the UI logic works with (lat/lng pulled out of the `[lon, lat]`
 *  GeoJSON coordinate order once, here, instead of at every call site). */
export function poisFromGeoJson(collection: CampsiteGeoJson): CampsitePoi[] {
  return collection.features.map((f) => ({
    id: f.properties.id,
    name: f.properties.name,
    category: f.properties.category,
    categoryLabel: f.properties.categoryLabel,
    pricePerNightEur: f.properties.pricePerNightEur,
    amenities: f.properties.amenities,
    description: f.properties.description,
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
  }));
}
