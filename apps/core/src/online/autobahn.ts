/**
 * Baustellen, Sperrungen und Warnungen von der Autobahn GmbH.
 *
 * ─── WOFÜR ──────────────────────────────────────────────────────────────────
 * Gewünscht: „Neben Kartendaten denke ich auch an sowas wie Verkehrsinfos,
 * Staus, Blitzer, Baustellen, Umleitungen oder Tankstellen und ihre Preise,
 * usw."
 *
 * Die Autobahn GmbH des Bundes betreibt dafür eine offene Schnittstelle: ohne
 * Schlüssel, ohne Anmeldung, ohne Konto. Für ein Wohnmobil ist sie besonders
 * brauchbar, weil dort neben Baustellen und Sperrungen auch Rastanlagen und
 * LKW-Parkplätze stehen — und ein LKW-Parkplatz ist für 7,5 Tonnen oft die
 * einzige Fläche, auf der man nachts legal steht.
 *
 * ─── WARUM DIESER CODE NICHTS BEHAUPTET ─────────────────────────────────────
 * Ich habe diese Schnittstelle NICHT aufgerufen. Die Netzregeln der
 * Entwicklungsumgebung lassen sie nicht durch — alle sieben Kandidaten, die
 * ich geprüft habe, kamen ohne Antwort zurück.
 *
 * Genau so ist der gpsd-Fehler entstanden: drei Diagnosen, alle plausibel,
 * alle falsch, weil ich geraten statt gemessen habe. Diesmal also andersherum:
 *
 *   * Der Leser sucht sich die Liste SELBST im JSON, statt einen Feldnamen zu
 *     erwarten (`parseListe`).
 *   * Koordinaten werden aus mehreren Schreibweisen gelesen, auch aus
 *     Zeichenketten (`leseKoordinate`) -- `long` statt `lon` ist in dieser
 *     Familie von Schnittstellen üblich, und eine vertauschte Erwartung
 *     ergäbe eine Meldung mitten im Atlantik.
 *   * Was wirklich ankam, sagt `diagnose.ts` im Klartext -- Endpunkt,
 *     Statuscode, gefundener Schlüssel, Anzahl, ein Beispiel.
 *
 * Wenn die Schnittstelle anders aussieht als vermutet, steht das danach auf
 * dem Bildschirm, statt sich als leere Liste zu tarnen.
 */

/** Was Yapaia aus einer Meldung macht — unabhängig davon, wie sie ankam. */
export interface Verkehrsmeldung {
  /** Stabile Kennung der Quelle, für „schon gesehen". */
  id: string;
  art: 'baustelle' | 'sperrung' | 'warnung' | 'parkplatz' | 'ladesaeule' | 'unbekannt';
  /** Die Autobahn, z. B. `A61`. */
  strasse: string;
  titel: string;
  /** Mehrzeilige Beschreibung, bereits zusammengefügt. Leer, wenn keine kam. */
  beschreibung: string;
  lat: number | null;
  lon: number | null;
}

/** Die Dienste, die diese Schnittstelle je Autobahn führt. */
export const AUTOBAHN_DIENSTE = {
  roadworks: 'baustelle',
  closure: 'sperrung',
  warning: 'warnung',
  parking_lorry: 'parkplatz',
  electric_charging_station: 'ladesaeule',
} as const;

export type AutobahnDienst = keyof typeof AUTOBAHN_DIENSTE;

/** Die Wurzel der Schnittstelle. Als Konstante, damit sie an EINER Stelle
 *  steht und in der Diagnose genannt werden kann. */
export const AUTOBAHN_BASIS = 'https://verkehr.autobahn.de/o/autobahn';

export function autobahnStrassenUrl(): string {
  return `${AUTOBAHN_BASIS}/`;
}

export function autobahnDienstUrl(strasse: string, dienst: AutobahnDienst): string {
  return `${AUTOBAHN_BASIS}/${encodeURIComponent(strasse)}/services/${dienst}`;
}

/**
 * Sucht die eigentliche Liste in einer Antwort.
 *
 * ─── WARUM NICHT EINFACH `json.roadworks` ───────────────────────────────────
 * Weil ich nicht nachsehen konnte, ob das Feld so heißt. Ein fest erwarteter
 * Name, den es nicht gibt, ergibt `undefined` — und daraus wird eine leere
 * Liste, also „keine Baustellen". Das ist die schlimmste Sorte Fehler in
 * diesem Projekt: er sieht aus wie eine gute Nachricht.
 *
 * Genommen wird deshalb die EINZIGE Eigenschaft der obersten Ebene, die ein
 * Feld ist. Gibt es mehrere, wird keine geraten — dann sagt die Diagnose, dass
 * es mehrdeutig war, und nennt die Namen.
 */
export function parseListe(json: unknown): {
  schluessel: string | null;
  eintraege: unknown[];
  mehrdeutig: string[];
} {
  if (Array.isArray(json)) {
    return { schluessel: '(Wurzel)', eintraege: json, mehrdeutig: [] };
  }
  if (json === null || typeof json !== 'object') {
    return { schluessel: null, eintraege: [], mehrdeutig: [] };
  }
  const felder = Object.entries(json as Record<string, unknown>).filter(([, v]) =>
    Array.isArray(v),
  );
  if (felder.length === 1) {
    return { schluessel: felder[0][0], eintraege: felder[0][1] as unknown[], mehrdeutig: [] };
  }
  return { schluessel: null, eintraege: [], mehrdeutig: felder.map(([k]) => k) };
}

/** Eine Zahl, auch wenn sie als Zeichenkette kommt. `null` sonst — NIE 0. */
export function alsZahl(wert: unknown): number | null {
  if (typeof wert === 'number') return Number.isFinite(wert) ? wert : null;
  if (typeof wert !== 'string') return null;
  const t = wert.trim();
  if (t.length === 0) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Liest Breite und Länge aus einem Eintrag.
 *
 * `long`, `lon` und `lng` sind alle im Umlauf; diese Familie von deutschen
 * Behördenschnittstellen benutzt überwiegend `long`. Eine vertauschte
 * Erwartung ergäbe keine Fehlermeldung, sondern eine Baustelle im Atlantik.
 *
 * Zahlen kommen dort häufig als Zeichenketten. `alsZahl` nimmt beides und
 * liefert bei Unsinn `null` und nicht 0 — 0/0 liegt im Golf von Guinea und
 * sähe wie eine echte Position aus.
 */
export function leseKoordinate(roh: unknown): { lat: number | null; lon: number | null } {
  if (roh === null || typeof roh !== 'object') return { lat: null, lon: null };
  const o = roh as Record<string, unknown>;
  const quelle = (o.coordinate ?? o.coordinates ?? o) as Record<string, unknown>;
  if (quelle === null || typeof quelle !== 'object') return { lat: null, lon: null };
  return {
    lat: alsZahl(quelle.lat ?? quelle.latitude),
    lon: alsZahl(quelle.long ?? quelle.lon ?? quelle.lng ?? quelle.longitude),
  };
}

/** Text aus einem Feld, das eine Zeichenkette ODER eine Liste davon sein kann. */
export function leseText(wert: unknown): string {
  if (typeof wert === 'string') return wert.trim();
  if (Array.isArray(wert)) {
    return wert
      .filter((z): z is string => typeof z === 'string')
      .map((z) => z.trim())
      .filter((z) => z.length > 0)
      .join('\n');
  }
  return '';
}

/**
 * Macht aus einem rohen Eintrag eine Yapaia-Meldung.
 *
 * Fehlt der Titel, wird KEINE Meldung erfunden: `null` heißt „damit lässt
 * sich nichts anfangen", und die Diagnose zählt das mit. Ein Eintrag ohne
 * Titel auf der Karte wäre ein Symbol, das niemand deuten kann.
 */
export function normalisiere(
  roh: unknown,
  strasse: string,
  dienst: AutobahnDienst,
): Verkehrsmeldung | null {
  if (roh === null || typeof roh !== 'object') return null;
  const o = roh as Record<string, unknown>;

  const titel = leseText(o.title) || leseText(o.subtitle);
  if (titel.length === 0) return null;

  const { lat, lon } = leseKoordinate(o);
  const id =
    leseText(o.identifier) ||
    leseText(o.id) ||
    // Kein Zufallswert: eine Kennung, die sich bei jedem Abruf ändert, macht
    // aus „schon gesehen" eine Ansage bei jeder Aktualisierung.
    `${strasse}:${dienst}:${titel}`;

  return {
    id,
    art: AUTOBAHN_DIENSTE[dienst],
    strasse,
    titel,
    beschreibung: leseText(o.description),
    lat,
    lon,
  };
}

/** Alle brauchbaren Meldungen einer Antwort, plus wie viele verworfen wurden. */
export function ausAntwort(
  json: unknown,
  strasse: string,
  dienst: AutobahnDienst,
): { meldungen: Verkehrsmeldung[]; verworfen: number; schluessel: string | null; mehrdeutig: string[] } {
  const { schluessel, eintraege, mehrdeutig } = parseListe(json);
  const meldungen: Verkehrsmeldung[] = [];
  let verworfen = 0;
  for (const eintrag of eintraege) {
    const m = normalisiere(eintrag, strasse, dienst);
    if (m) meldungen.push(m);
    else verworfen += 1;
  }
  return { meldungen, verworfen, schluessel, mehrdeutig };
}
