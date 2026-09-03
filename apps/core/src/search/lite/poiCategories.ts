/**
 * Welche Sonderziele der Offline-Index kennt — und unter welchen deutschen
 * Wörtern man sie findet.
 *
 * ─── DAS PROBLEM, DAS DIESE DATEI LÖST ──────────────────────────────────────
 * Der Betreiber hat es genau benannt: „Ich würde gerne in wahlfreier
 * Reihenfolge Stadt oder Straße oder einen poi wie einen Supermarkt,
 * Campingplatz, Arzt oder Ähnliches eingeben können."
 *
 * „Supermarkt" ist aber kein NAME. In OpenStreetMap heißt der Laden „REWE"
 * und trägt `shop=supermarket`; die Praxis heißt „Dr. Müller" und trägt
 * `amenity=doctors`. Ein Index, der nur Namen kennt, findet bei „Supermarkt"
 * nichts — und bei „Arzt" auch nicht.
 *
 * Deshalb bekommt jeder Eintrag hier zusätzlich zum Namen eine Reihe
 * deutscher SUCHBEGRIFFE, die mitindiziert werden. „REWE" findet den Laden
 * über den Namen, „Supermarkt" über die Kategorie. Beides führt auf denselben
 * Eintrag.
 *
 * ─── WARUM EINE AUSWAHL UND NICHT ALLES ─────────────────────────────────────
 * `amenity`/`shop`/`tourism` umfassen in OSM tausende Werte, darunter jede
 * Parkbank und jeder Abfalleimer. Die alle aufzunehmen würde den Index
 * aufblähen und die Trefferliste verwässern, ohne einem Fahrer zu helfen.
 * Diese Liste ist deshalb auf das zugeschnitten, was auf einer Wohnmobilfahrt
 * zählt: übernachten, versorgen, entsorgen, tanken, im Notfall Hilfe finden.
 *
 * Sie ist bewusst eine EXPLIZITE Liste und keine Heuristik: was hier nicht
 * steht, ist nicht im Index, und das ist an einer Stelle nachlesbar statt über
 * den Quelltext verteilt.
 *
 * ─── EINE DATEI, ZWEI VERWENDUNGEN ──────────────────────────────────────────
 * Dieselbe Liste erzeugt den `osmium`-Filter im Bau-Skript (`osmiumFilters`)
 * UND die Suchbegriffe beim Indizieren. Ohne diese Kopplung würden Filter und
 * Normalisierer auseinanderlaufen: `osmium` liefert dann Daten, die niemand
 * einordnet, oder der Normalisierer wartet auf Daten, die nie kommen.
 */

/** Der OSM-Schlüssel, unter dem eine Kategorie steht. */
export type PoiTagKey = 'amenity' | 'shop' | 'tourism' | 'leisure';

export interface PoiCategory {
  /** OSM-Tag-Wert, z. B. `supermarket`. Zugleich der `type` im Suchergebnis
   *  und damit der Schlüssel für das Symbol (`apps/web/src/search/icons.ts`). */
  value: string;
  /** Wie ein unbenannter Eintrag heißt. Ein Campingplatz ohne Namen ist immer
   *  noch ein Campingplatz — ihn wegzulassen wäre der größere Verlust. */
  label: string;
  /** Wörter, unter denen man ihn sucht. `label` gehört nicht noch einmal
   *  hinein, es wird ohnehin mitindiziert. Umgangssprache ausdrücklich
   *  erwünscht: wer „Klo" tippt, meint die Toilette. */
  terms: readonly string[];
}

export const POI_CATEGORIES: Readonly<Record<PoiTagKey, readonly PoiCategory[]>> = {
  amenity: [
    { value: 'fuel', label: 'Tankstelle', terms: ['tanken', 'benzin', 'diesel', 'sprit'] },
    { value: 'charging_station', label: 'Ladesäule', terms: ['laden', 'strom', 'elektro'] },
    { value: 'parking', label: 'Parkplatz', terms: ['parken', 'stellplatz'] },
    { value: 'toilets', label: 'Toilette', terms: ['wc', 'klo'] },
    { value: 'drinking_water', label: 'Trinkwasser', terms: ['wasser', 'frischwasser'] },
    // Die drei Wohnmobil-Kernbedürfnisse neben Strom und Wasser.
    { value: 'sanitary_dump_station', label: 'Entsorgungsstation', terms: ['entsorgung', 'abwasser', 'chemietoilette', 'ver- und entsorgung'] },
    { value: 'waste_disposal', label: 'Müllentsorgung', terms: ['muell', 'müll', 'abfall'] },
    { value: 'pharmacy', label: 'Apotheke', terms: ['medikamente', 'notdienst'] },
    { value: 'doctors', label: 'Arztpraxis', terms: ['arzt', 'aerztin', 'ärztin', 'hausarzt', 'praxis'] },
    { value: 'hospital', label: 'Krankenhaus', terms: ['klinik', 'notaufnahme', 'notfall'] },
    { value: 'veterinary', label: 'Tierarzt', terms: ['tierarztpraxis', 'tiermedizin'] },
    { value: 'restaurant', label: 'Restaurant', terms: ['essen', 'gaststaette', 'gaststätte', 'wirtshaus'] },
    { value: 'cafe', label: 'Café', terms: ['cafe', 'kaffee'] },
    { value: 'fast_food', label: 'Imbiss', terms: ['schnellrestaurant'] },
    { value: 'bank', label: 'Bank', terms: ['geldautomat', 'sparkasse'] },
    { value: 'atm', label: 'Geldautomat', terms: ['bargeld', 'geld'] },
    { value: 'post_office', label: 'Post', terms: ['postamt', 'paket'] },
  ],
  shop: [
    { value: 'supermarket', label: 'Supermarkt', terms: ['lebensmittel', 'einkaufen', 'einkauf', 'markt'] },
    { value: 'convenience', label: 'Lebensmittelladen', terms: ['einkaufen', 'kiosk', 'tante emma'] },
    { value: 'bakery', label: 'Bäckerei', terms: ['baecker', 'bäcker', 'broetchen', 'brötchen', 'brot'] },
    { value: 'butcher', label: 'Metzgerei', terms: ['fleischerei', 'metzger'] },
    { value: 'greengrocer', label: 'Obst und Gemüse', terms: ['gemuese', 'gemüse', 'obst'] },
    { value: 'doityourself', label: 'Baumarkt', terms: ['heimwerker', 'werkzeug'] },
    { value: 'hardware', label: 'Eisenwaren', terms: ['werkzeug', 'schrauben'] },
    { value: 'laundry', label: 'Waschsalon', terms: ['waschen', 'waesche', 'wäsche'] },
    { value: 'gas', label: 'Gasflaschen', terms: ['gas', 'propan', 'fluessiggas', 'flüssiggas'] },
  ],
  tourism: [
    { value: 'camp_site', label: 'Campingplatz', terms: ['camping', 'zelten', 'campen'] },
    { value: 'caravan_site', label: 'Wohnmobilstellplatz', terms: ['stellplatz', 'wohnmobil', 'camping', 'reisemobil'] },
    { value: 'hotel', label: 'Hotel', terms: ['uebernachten', 'übernachten'] },
    { value: 'guest_house', label: 'Pension', terms: ['gaestehaus', 'gästehaus', 'uebernachten', 'übernachten'] },
    { value: 'viewpoint', label: 'Aussichtspunkt', terms: ['aussicht', 'panorama'] },
    { value: 'information', label: 'Information', terms: ['touristinfo', 'infopoint'] },
    { value: 'attraction', label: 'Sehenswürdigkeit', terms: ['sehenswuerdigkeit', 'ausflug'] },
  ],
  leisure: [
    { value: 'swimming_pool', label: 'Schwimmbad', terms: ['baden', 'schwimmen'] },
    { value: 'sports_centre', label: 'Sportzentrum', terms: ['sport', 'halle'] },
    { value: 'playground', label: 'Spielplatz', terms: ['spielen', 'kinder'] },
  ],
};

/** Nachschlagen in einer flachen Map — der Normalisierer prüft je Feature
 *  alle vier Schlüssel und braucht das schnell. */
const BY_KEY_VALUE = new Map<string, PoiCategory>();
for (const [key, categories] of Object.entries(POI_CATEGORIES)) {
  for (const category of categories) {
    BY_KEY_VALUE.set(`${key}=${category.value}`, category);
  }
}

/** Die Kategorie zu einem Tag-Paar, oder `undefined`, wenn dieser Wert nicht
 *  im Index geführt wird. */
export function findPoiCategory(key: string, value: string): PoiCategory | undefined {
  return BY_KEY_VALUE.get(`${key}=${value}`);
}

/**
 * Die `osmium tags-filter`-Ausdrücke für genau diese Kategorien, z. B.
 * `nwr/amenity=fuel,parking,...`.
 *
 * `nwr` (Node, Way, Relation) und nicht nur `n`: ein Supermarkt ist meistens
 * ein GEBÄUDE, also eine Fläche, und ein Campingplatz fast immer. Nur Knoten
 * zu filtern würde die Mehrzahl der interessanten Ziele verlieren — und zwar
 * lautlos.
 */
export function osmiumFilters(): string[] {
  return Object.entries(POI_CATEGORIES).map(
    ([key, categories]) => `nwr/${key}=${categories.map((c) => c.value).join(',')}`,
  );
}

/**
 * Die Wörter, unter denen ein Eintrag dieser Kategorie gefunden werden soll —
 * ohne den Namen selbst, den fügt der Aufrufer hinzu.
 */
export function searchTermsFor(category: PoiCategory): string {
  return [category.label, ...category.terms].join(' ');
}
