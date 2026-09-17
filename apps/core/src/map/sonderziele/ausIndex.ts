/**
 * Aus dem Suchindex auf die Karte.
 *
 * ─── DIE EINE REGEL DIESER DATEI ────────────────────────────────────────────
 * Was sie NICHT liefern konnte, sagt sie. Keine Ausnahme.
 *
 * Eine Karte ohne Entsorgungssymbol kann dreierlei heißen: es gibt hier
 * keine, der Index wurde nie gebaut, oder er ist zu alt und kennt die Spalte
 * `category` nicht. Für jemanden mit vollem Abwassertank sind das drei ganz
 * verschiedene Auskünfte — und ohne diese Felder sehen alle drei gleich aus.
 *
 * Genau diese Verwechslung zieht sich durch dieses Projekt: die leere Fläche
 * statt „hier gibt es keine Karte", „Route unmöglich" statt „für dieses Land
 * gibt es keinen Graphen", „alle brauchbar" für sechzig Einträge ohne Ort.
 * Jedes Mal war die Auskunft vorhanden und nur nicht erreichbar.
 */

import { LiteIndexReader } from '../../search/lite/reader.js';
import {
  listLiteSearchDbFiles,
  regionFromLiteSearchFile,
  resolveLiteSearchDir,
} from '../../search/lite/paths.js';
import { basename } from 'node:path';
import { FEHLENDE_KATEGORIEN, FEHLENDE_KLASSEN, klasseFuer } from './fehlendeKlassen.js';

/**
 * Wie viele Einträge je Index höchstens gelesen werden.
 *
 * ─── WIE DIE ZAHL ZUSTANDE KOMMT ────────────────────────────────────────────
 * Sie ist eine SICHERUNG und keine Messung, und sie steht deshalb benannt da.
 * Gemessen werden könnte sie nur an einem echten Deutschland-Index, den es
 * hier nicht gibt.
 *
 * Die Größenordnung: Entsorgungsstationen sind in Deutschland vierstellig,
 * nicht sechsstellig. 20 000 lässt dafür reichlich Luft und begrenzt zugleich
 * den Schaden, falls dieser Liste je eine häufige Kategorie zugefügt wird.
 * 20 000 Punkte sind als GeoJSON wenige Megabyte — über eine Verbindung im
 * selben Haus vertretbar, einmal je Sitzung.
 *
 * Wird sie erreicht, ist die Antwort gekappt und sagt das auch.
 */
export const SONDERZIELE_HOECHSTENS_JE_INDEX = 20_000;

/** Ein Sonderziel, fertig für die Karte. */
export interface Sonderziel {
  name: string;
  lat: number;
  lon: number;
  /** Der OSM-Tag-Wert (`sanitary_dump_station`, …). */
  kategorie: string;
  /** Deutscher Name der Kategorie — für die Tippkarte. */
  bezeichnung: string;
  /** Name im Sprite. */
  symbol: string;
  /** Kollisionsrang, vergleichbar mit dem der Kachel-POIs. */
  rang: number;
  /** Straße und Hausnummer, sofern getaggt. */
  adresse?: string;
  /** Der Ort. */
  ort?: string;
}

/** Was an einem einzelnen Index nicht ging. */
export interface IndexBefund {
  /** Die Region, oder `null` für den alten Sammelindex. */
  region: string | null;
  datei: string;
  /** Wie viele Einträge dieser Index beigesteuert hat. */
  anzahl: number;
  /**
   * `true`, wenn die Grenze erreicht wurde — es gibt also mehr, als hier
   * steht. Ohne dieses Feld wäre eine halbe Karte von einer ganzen nicht zu
   * unterscheiden.
   */
  gekappt: boolean;
  /**
   * Gesetzt, wenn dieser Index nichts liefern KONNTE — mit dem Grund im
   * Klartext. Nicht dasselbe wie „hat nichts gefunden".
   */
  fehler?: string;
}

export interface SonderzieleErgebnis {
  ziele: Sonderziel[];
  /** Je gelesenem Index eine Zeile — auch für die, die nichts hatten. */
  indizes: IndexBefund[];
  /**
   * Die Kategorien, um die es geht, mit Begründung. Steht in der Antwort,
   * damit die Frage „warum kommt das aus einer anderen Quelle?" dort
   * beantwortet ist, wo jemand sie stellt.
   */
  kategorien: typeof FEHLENDE_KLASSEN;
}

/** Eine Zeichenkette, die wirklich eine ist — sonst `undefined`. */
function text(wert: string | null | undefined): string | undefined {
  if (typeof wert !== 'string') return undefined;
  const t = wert.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Ein Ort, der auf einer Karte liegen kann.
 *
 * Dieselbe Prüfung wie bei den Verkehrsmeldungen (`verkehrGeoJson.ts`), und
 * aus demselben Grund: 0/0 ist der Golf von Guinea und in Wahrheit immer ein
 * fehlender Wert. Ein Symbol dort ist schlimmer als keines — es ist eine
 * Behauptung.
 */
function istOrt(lat: unknown, lon: unknown): lat is number {
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  return !(lat === 0 && lon === 0);
}

/**
 * Liest alle Sonderziele aus allen gebauten Suchindizes.
 *
 * @param dateien   Nur für Tests: die Indexdateien statt der echten Suche.
 * @param hoechstens Die Kappungsgrenze je Index. Sie ist hier einstellbar,
 *   damit der gekappte Fall wirklich GEPRÜFT werden kann. Mit der echten
 *   fünfstelligen Zahl bräuchte ein Test zwanzigtausend Datensätze — und ein
 *   Test, der zu teuer ist, wird nicht geschrieben. Dann stünde `gekappt`
 *   ungeprüft im Code, ausgerechnet das Feld, das eine halbe Karte von einer
 *   ganzen unterscheidet.
 */
export function leseSonderziele(
  dateien?: readonly string[],
  hoechstens: number = SONDERZIELE_HOECHSTENS_JE_INDEX,
): SonderzieleErgebnis {
  const pfade = dateien ?? listLiteSearchDbFiles(resolveLiteSearchDir());
  const ziele: Sonderziel[] = [];
  const indizes: IndexBefund[] = [];

  for (const pfad of pfade) {
    const datei = basename(pfad);
    const region = regionFromLiteSearchFile(datei);
    const leser = new LiteIndexReader(pfad);
    try {
      const zeilen = leser.byCategories(FEHLENDE_KATEGORIEN, hoechstens);
      let genommen = 0;
      for (const z of zeilen) {
        const klasse = z.category ? klasseFuer(z.category) : undefined;
        // Kann nicht vorkommen, solange die Abfrage dieselbe Liste benutzt --
        // aber eine Zeile ohne Klasse haette kein Symbol und waere unsichtbar,
        // und unsichtbar ist genau die Sorte Fehler, die hier nicht passieren
        // soll.
        if (!klasse) continue;
        if (!istOrt(z.lat, z.lon)) continue;
        const name = text(z.name) ?? klasse.name;
        ziele.push({
          name,
          lat: z.lat,
          lon: z.lon,
          kategorie: klasse.kategorie,
          bezeichnung: klasse.name,
          symbol: klasse.symbol,
          rang: klasse.rang,
          ...(text(z.address) ? { adresse: text(z.address) as string } : {}),
          ...(text(z.locality) ? { ort: text(z.locality) as string } : {}),
        });
        genommen += 1;
      }
      indizes.push({
        region,
        datei,
        anzahl: genommen,
        gekappt: zeilen.length >= hoechstens,
      });
    } catch (fehler) {
      // Ein unlesbarer Index darf die anderen nicht mitnehmen: wer
      // Deutschland und Frankreich installiert hat, soll Frankreich sehen,
      // auch wenn Deutschland gerade neu gebaut wird.
      indizes.push({
        region,
        datei,
        anzahl: 0,
        gekappt: false,
        fehler: fehler instanceof Error ? fehler.message : String(fehler),
      });
    } finally {
      leser.close();
    }
  }

  return { ziele, indizes, kategorien: FEHLENDE_KLASSEN };
}

/** Ein GeoJSON-Punkt, wie MapLibre ihn erwartet. */
export interface SonderzielFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    name: string;
    kategorie: string;
    bezeichnung: string;
    symbol: string;
    rang: number;
    adresse?: string;
    ort?: string;
  };
}

export interface SonderzieleGeoJson {
  type: 'FeatureCollection';
  features: SonderzielFeature[];
  /**
   * Was die Karte über ihre eigene Vollständigkeit wissen muss.
   *
   * GeoJSON erlaubt zusätzliche Felder auf oberster Ebene, und MapLibre
   * ignoriert sie. Sie hier unterzubringen statt in einer Hülle daneben
   * heißt: die Auskunft reist mit den Daten und kann nicht verloren gehen,
   * wenn irgendwo nur `features` weitergereicht wird.
   */
  befund: {
    indizes: IndexBefund[];
    kategorien: typeof FEHLENDE_KLASSEN;
    /** `true`, wenn irgendein Index gekappt wurde. */
    gekappt: boolean;
    /** `true`, wenn gar kein Index gelesen werden konnte. */
    ohne_index: boolean;
  };
}

/** Das Ergebnis als GeoJSON. */
export function alsGeoJson(ergebnis: SonderzieleErgebnis): SonderzieleGeoJson {
  return {
    type: 'FeatureCollection',
    features: ergebnis.ziele.map((z) => ({
      type: 'Feature' as const,
      // GeoJSON ist [Länge, Breite] — in dieser Reihenfolge, und schon
      // mehrfach andersherum eingebaut worden.
      geometry: { type: 'Point' as const, coordinates: [z.lon, z.lat] as [number, number] },
      properties: {
        name: z.name,
        kategorie: z.kategorie,
        bezeichnung: z.bezeichnung,
        symbol: z.symbol,
        rang: z.rang,
        ...(z.adresse ? { adresse: z.adresse } : {}),
        ...(z.ort ? { ort: z.ort } : {}),
      },
    })),
    befund: {
      indizes: ergebnis.indizes,
      kategorien: ergebnis.kategorien,
      gekappt: ergebnis.indizes.some((i) => i.gekappt),
      ohne_index: ergebnis.indizes.length === 0,
    },
  };
}
