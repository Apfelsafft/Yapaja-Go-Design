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
    // Die Wohnmobil-Kernbedürfnisse neben Strom.
    { value: 'sanitary_dump_station', label: 'Entsorgungsstation', terms: ['entsorgung', 'abwasser', 'chemietoilette', 'ver- und entsorgung'] },
    { value: 'waste_disposal', label: 'Müllentsorgung', terms: ['muell', 'müll', 'abfall'] },
    // ─── WARUM `water_point` NEBEN `drinking_water` STEHT ────────────────────
    // Sie sehen sich ähnlich und sind es nicht. `drinking_water` ist eine
    // Stelle, an der man TRINKT -- ein Brunnen, ein Wasserhahn am Spielplatz.
    // `water_point` ist eine Zapfstelle, die dafür gemacht ist, einen TANK zu
    // füllen; in OSM ist sie ausdrücklich für Fahrzeuge und Boote gedacht.
    //
    // Für ein Wohnmobil ist der Unterschied der zwischen „hier kann ich einen
    // Becher füllen" und „hier kann ich weiterfahren". Beide unter einem
    // Begriff zu führen hiesse, den selteneren und wichtigeren im häufigeren
    // verschwinden zu lassen.
    { value: 'water_point', label: 'Frischwasser-Zapfstelle', terms: ['frischwasser', 'wasser', 'tanken', 'wassertank', 'auffuellen', 'auffüllen'] },
    { value: 'shower', label: 'Dusche', terms: ['duschen', 'waschen', 'sanitaer', 'sanitär'] },
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

/**
 * ─── ALLES, WAS EINEN NAMEN HAT (0.39.0) ────────────────────────────────────
 * Gemeldet: „Wenn ich jetzt wieder nach Firmennamen wie Rewe oder Caratec
 * suche findet er sie nicht." Caratec steht auf der Karte, war aber nie im
 * Index: eine Firma trägt `office=company` oder `craft=*`, und beides stand
 * oben nicht. Die Liste oben bleibt die Auswahl, die man ÜBER DIE KATEGORIE
 * findet („Supermarkt"). Wer einen NAMEN tippt, soll alles finden, was so
 * heißt -- egal welcher Art.
 *
 * Deshalb kommt zusätzlich jedes BENANNTE Objekt unter diesen Schlüsseln in
 * den Index, mit einer groben Bezeichnung der Art. Unbenannte nicht: eine
 * namenlose Firma sucht niemand, und das wären Millionen.
 */
export interface NamedPoiKey {
  /** OSM-Schlüssel. */
  key: string;
  /** Nur diese Werte; fehlt die Liste, zählt jeder Wert. */
  values?: readonly string[];
  /** Wie die Art heißt, wenn kein Name sie verrät. */
  label: string;
  terms: readonly string[];
}

export const NAMED_POI_KEYS: readonly NamedPoiKey[] = [
  { key: 'shop', label: 'Geschäft', terms: ['laden', 'einkaufen'] },
  { key: 'office', label: 'Firma', terms: ['büro', 'buero', 'unternehmen'] },
  { key: 'craft', label: 'Handwerksbetrieb', terms: ['handwerk', 'werkstatt', 'firma'] },
  { key: 'healthcare', label: 'Gesundheit', terms: ['praxis'] },
  { key: 'amenity', label: 'Einrichtung', terms: [] },
  { key: 'tourism', label: 'Tourismus', terms: [] },
  { key: 'leisure', label: 'Freizeit', terms: [] },
  { key: 'man_made', values: ['works'], label: 'Werk', terms: ['firma', 'fabrik'] },
  { key: 'landuse', values: ['industrial', 'commercial', 'retail'], label: 'Gewerbegebiet', terms: ['gewerbe'] },
  { key: 'building', label: 'Gebäude', terms: [] },
];

/** Werte, die auch mit Namen nur im Weg stünden. */
const NAMED_EXCLUDED: ReadonlySet<string> = new Set([
  'amenity=bench',
  'amenity=waste_basket',
  'amenity=vending_machine',
  'amenity=parking_space',
  'amenity=parking_entrance',
  'amenity=bicycle_parking',
  'amenity=hunting_stand',
  'amenity=grit_bin',
  'amenity=clock',
  'leisure=picnic_table',
]);

/** Die Art eines benannten Objekts, oder `undefined`. Ein Gebäude zählt nur,
 *  wenn sonst nichts passt (es steht zuletzt) -- dann heißt es „Gebäude". */
export function findNamedPoiKey(
  props: Record<string, unknown>,
): { key: NamedPoiKey; value: string } | undefined {
  for (const key of NAMED_POI_KEYS) {
    const value = props[key.key];
    if (typeof value !== 'string' || value.length === 0 || value === 'no') continue;
    if (key.values && !key.values.includes(value)) continue;
    if (NAMED_EXCLUDED.has(`${key.key}=${value}`)) continue;
    return { key, value };
  }
  return undefined;
}

/** Die `osmium`-Ausdrücke für den zweiten Durchgang über die BENANNTEN
 *  Objekte (der erste filtert `nwr/name`). */
export function namedOsmiumFilters(): string[] {
  return NAMED_POI_KEYS.map((k) => (k.values ? `nwr/${k.key}=${k.values.join(',')}` : `nwr/${k.key}`));
}

export function namedSearchTerms(key: NamedPoiKey): string {
  return [key.label, ...key.terms].join(' ');
}
