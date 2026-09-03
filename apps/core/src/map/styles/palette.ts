/**
 * Die Farbrollen eines Kartenstils.
 *
 * ─── WARUM ES DIESE DATEI GIBT ──────────────────────────────────────────────
 * Der Betreiber: „Die Karten sehen irgendwie langweilig aus. Die von Maps oder
 * Karten sind viel ansprechender."
 *
 * Er hat recht, und der Grund war nicht der Geschmack, sondern eine Lücke:
 * unsere Stile zeichneten DREI Ebenen — eine graue Linie für jede Straße,
 * Ortsnamen, POI-Namen. Die Kacheln enthalten aber sechzehn:
 *
 *   aerodrome_label, aeroway, boundary, building, housenumber, landcover,
 *   landuse, mountain_peak, park, place, poi, transportation,
 *   transportation_name, water, water_name, waterway
 *
 * Kein Wasser, kein Wald, keine Wiese, kein Park, kein Gebäude, keine
 * Straßenhierarchie, keine Straßennamen. Was übrig blieb, war ein Drahtgitter
 * auf beigem Grund — genau das, was auf dem Bildschirm zu sehen war.
 *
 * Die Ebenenliste oben ist NICHT geraten: sie stammt aus
 * `OpenMapTilesSchema.java` des Profils, mit dem planetiler unsere Kacheln
 * baut (openmaptiles/planetiler-openmaptiles). Ebenso die Klassenwerte, nach
 * denen `baseLayers.ts` filtert. Ein Stil, der eine Ebene nennt, die es nicht
 * gibt, wäre nämlich nicht kaputt, sondern LEER — und damit von genau dem
 * Zustand nicht zu unterscheiden, der hier behoben wird.
 *
 * ─── WARUM PALETTE UND EBENEN GETRENNT SIND ─────────────────────────────────
 * Die Kartografie — welche Ebene über welcher liegt, ab welchem Zoom, wie
 * breit eine Straße bei welchem Maßstab wird — ist in allen Stilen dieselbe
 * Arbeit. Nur die Farben unterscheiden sie. Getrennt gehalten heißt: ein neuer
 * Stil ist eine Palette und keine 200 Zeilen, und eine Verbesserung an der
 * Kartografie erreicht alle Stile auf einmal statt drei Kopien.
 */

export interface MapPalette {
  /** Grundfläche unter allem. */
  background: string;

  // ─── Landbedeckung (`landcover`) ─────────────────────────────────────────
  wood: string;
  grass: string;
  farmland: string;
  sand: string;
  rock: string;
  wetland: string;
  ice: string;

  // ─── Flächennutzung (`landuse`) und Parks (`park`) ───────────────────────
  residential: string;
  industrial: string;
  /** Schule, Krankenhaus, Universität — Einrichtungen. */
  institution: string;
  cemetery: string;
  park: string;

  // ─── Wasser ──────────────────────────────────────────────────────────────
  water: string;
  waterway: string;

  // ─── Gebäude ─────────────────────────────────────────────────────────────
  building: string;
  buildingOutline: string;

  // ─── Straßen: Füllung und Umrandung ──────────────────────────────────────
  motorway: string;
  motorwayCasing: string;
  trunk: string;
  trunkCasing: string;
  primary: string;
  primaryCasing: string;
  secondary: string;
  secondaryCasing: string;
  minor: string;
  minorCasing: string;
  service: string;
  /** Wege und Pfade — gestrichelt gezeichnet. */
  path: string;
  /** Bahnstrecken. */
  rail: string;

  // ─── Grenzen ─────────────────────────────────────────────────────────────
  boundary: string;

  // ─── Beschriftung ────────────────────────────────────────────────────────
  placeText: string;
  placeHalo: string;
  roadText: string;
  roadHalo: string;
  waterText: string;
  poiText: string;
  poiHalo: string;

  /**
   * Faktor auf alle Straßenbreiten. `1` ist die normale Zeichnung; der
   * Kontraststil hebt ihn an, damit der Straßenverlauf auch bei schlechtem
   * Licht und aus Fahrerentfernung erkennbar bleibt — und `styles.test.ts`
   * hält fest, dass er dort wirklich dicker ist.
   */
  roadWidthScale: number;
}

/** Heller Tagesstil. Warme, entsättigte Grundtöne, damit die Route und die
 *  eigene Position als kräftigste Elemente auf der Karte bleiben. */
export const LIGHT_PALETTE: MapPalette = {
  background: '#F5F3EC',
  wood: '#CFDFC4',
  grass: '#DEE9D2',
  farmland: '#EDE8D5',
  sand: '#F2EAD3',
  rock: '#E3DFD8',
  wetland: '#D6E3DA',
  ice: '#E8F1F5',
  residential: '#ECE9E2',
  industrial: '#E7E4DC',
  institution: '#EAE6E9',
  cemetery: '#DEE5D8',
  park: '#CFE3C4',
  water: '#A8CCE0',
  waterway: '#9CC3D9',
  building: '#E2DCD2',
  buildingOutline: '#D3CCC0',
  motorway: '#F5A25D',
  motorwayCasing: '#D9822B',
  trunk: '#F7B977',
  trunkCasing: '#DE9A46',
  primary: '#FBD08A',
  primaryCasing: '#DDAE5C',
  secondary: '#FDE3AE',
  secondaryCasing: '#DCC084',
  minor: '#FFFFFF',
  minorCasing: '#D8D2C6',
  service: '#F7F5EF',
  path: '#B49A78',
  rail: '#B4AFA4',
  boundary: '#A99FB0',
  placeText: '#26282B',
  placeHalo: '#F5F3EC',
  roadText: '#4A4640',
  roadHalo: '#FFFFFF',
  waterText: '#3C6E8F',
  poiText: '#5C5648',
  poiHalo: '#F5F3EC',
  roadWidthScale: 1,
};

/** Nachtstil. Nicht die helle Palette invertiert, sondern eigene Töne: ein
 *  invertiertes Grün wird magenta, und eine Karte, die nachts nach nichts
 *  aussieht, hilft im Dunkeln am wenigsten. */
export const DARK_PALETTE: MapPalette = {
  background: '#14171C',
  wood: '#1B2A21',
  grass: '#1E2A22',
  farmland: '#1F2119',
  sand: '#26241C',
  rock: '#212327',
  wetland: '#182420',
  ice: '#1E2A31',
  residential: '#191C21',
  industrial: '#1C1E22',
  institution: '#1E1B21',
  cemetery: '#1A211B',
  park: '#1D3025',
  water: '#16323F',
  waterway: '#1B4051',
  building: '#20242A',
  buildingOutline: '#2A2F36',
  motorway: '#B96A2A',
  motorwayCasing: '#7A4318',
  trunk: '#A76428',
  trunkCasing: '#6E4014',
  primary: '#8C6A34',
  primaryCasing: '#5E4620',
  secondary: '#6B5A38',
  secondaryCasing: '#493C24',
  minor: '#3A3F46',
  minorCasing: '#22262B',
  service: '#2C3037',
  path: '#5A5344',
  rail: '#41474E',
  boundary: '#5B5266',
  placeText: '#E8EAED',
  placeHalo: '#14171C',
  roadText: '#C3C7CC',
  roadHalo: '#14171C',
  waterText: '#7FB4CE',
  poiText: '#A9A294',
  poiHalo: '#14171C',
  roadWidthScale: 1,
};

/** Kontraststil (Barrierefreiheit, docs/06 §6). Heller Grund, dunkle
 *  Beschriftung, kräftig gezeichnete Straßen, zurückgenommene Flächen —
 *  damit Struktur zählt und nicht Farbigkeit. */
export const CONTRAST_PALETTE: MapPalette = {
  background: '#FFFFFF',
  wood: '#D8E8D0',
  grass: '#E6F0E0',
  farmland: '#F2EFE2',
  sand: '#F5F0DC',
  rock: '#EDEDED',
  wetland: '#DCEAE4',
  ice: '#EDF6FA',
  residential: '#F4F4F4',
  industrial: '#EFEFEF',
  institution: '#F2EFF4',
  cemetery: '#E6EEE2',
  park: '#D2EAC8',
  water: '#7FB6D8',
  waterway: '#6BA5CC',
  building: '#DCDCDC',
  buildingOutline: '#9A9A9A',
  motorway: '#E8730C',
  motorwayCasing: '#000000',
  trunk: '#EE8B22',
  trunkCasing: '#000000',
  primary: '#F5AE3C',
  primaryCasing: '#1A1A1A',
  secondary: '#FBCE72',
  secondaryCasing: '#333333',
  minor: '#FFFFFF',
  minorCasing: '#4A4A4A',
  service: '#FAFAFA',
  path: '#7A5C34',
  rail: '#666666',
  boundary: '#6B5E78',
  placeText: '#000000',
  placeHalo: '#FFFFFF',
  roadText: '#1A1A1A',
  roadHalo: '#FFFFFF',
  waterText: '#1B4A69',
  poiText: '#2A2A2A',
  poiHalo: '#FFFFFF',
  roadWidthScale: 1.6,
};

/** Naturstil. Landbedeckung und Wege treten hervor, versiegelte Flächen
 *  treten zurück — gedacht für die Suche nach Stell- und Campingplätzen und
 *  für Strecken abseits der Hauptstraßen. */
export const OUTDOOR_PALETTE: MapPalette = {
  background: '#F2F0E4',
  wood: '#AFCF9E',
  grass: '#CDE3B5',
  farmland: '#E6DFC0',
  sand: '#EFE2BE',
  rock: '#DAD5CA',
  wetland: '#BFD8C9',
  ice: '#DDEEF4',
  residential: '#E9E5D9',
  industrial: '#E2DED2',
  institution: '#E6E1E4',
  cemetery: '#D4E0CB',
  park: '#B6DCA1',
  water: '#8FC4DE',
  waterway: '#79B4D3',
  building: '#DED7C8',
  buildingOutline: '#C6BDA9',
  motorway: '#EE9A57',
  motorwayCasing: '#C9762F',
  trunk: '#F0AE73',
  trunkCasing: '#CA8A45',
  primary: '#F3C88A',
  primaryCasing: '#C9A467',
  secondary: '#F7DCAC',
  secondaryCasing: '#CBB689',
  minor: '#FFFDF6',
  minorCasing: '#CFC7B4',
  service: '#F4F1E6',
  // Wege sind hier absichtlich kräftiger als in den anderen Stilen: sie sind
  // der Grund, warum jemand diesen Stil waehlt.
  path: '#8A6A3E',
  rail: '#A9A395',
  boundary: '#9E93A8',
  placeText: '#22301F',
  placeHalo: '#F2F0E4',
  roadText: '#43453C',
  roadHalo: '#FFFFFF',
  waterText: '#2F6683',
  poiText: '#4C4A34',
  poiHalo: '#F2F0E4',
  roadWidthScale: 1,
};
