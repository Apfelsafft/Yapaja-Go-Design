/**
 * Das Tempolimit an der Stelle, an der das Fahrzeug GERADE steht.
 *
 * ─── DIE LÜCKE ──────────────────────────────────────────────────────────────
 * `sensor.yapaja_speed_limit` blieb `unknown`, solange keine Route lief. Von
 * den zehn Yapaia-Entitäten war es die einzige, die zu Unrecht leer war: ETA
 * und Anweisung gibt es ohne Ziel wirklich nicht, ein Tempolimit schon.
 *
 * Für ein fest verbautes Display ist das der Unterschied zwischen nützlich
 * und Zierde — ohne Route fährt man die meiste Zeit. Das runde Verkehrszeichen
 * war längst gezeichnet; es bekam nur nie einen Wert.
 *
 * ─── WARUM EINE SPUR UND KEIN EINZELPUNKT ───────────────────────────────────
 * Nachgemessen in Valhallas Quelltext: `/locate` liefert **kein**
 * `speed_limit` (kein einziges Vorkommen in `tyr/locate_serializer.cc`),
 * `/trace_attributes` schon (`tyr/trace_serializer.cc`). Es braucht also eine
 * Kartenzuordnung, und die braucht eine Spur.
 *
 * Das ist aber nicht nur ein technischer Zwang, sondern auch richtig so: ein
 * einzelner Punkt hat keine Richtung. Neben einer Autobahn verläuft oft eine
 * Nebenstraße, und zwischen beiden ist mit einem Punkt nicht zu unterscheiden
 * — mit einer Fahrtlinie schon.
 *
 * ─── UND WARUM DIE GENAUIGKEIT ZÄHLT ────────────────────────────────────────
 * Aus dem laufenden Betrieb gemeldet: `gps_accuracy: 53.2`. Auf zweiundfünfzig
 * Metern liegen Autobahn, Auffahrt und Parallelstraße nebeneinander. Eine
 * Zuordnung, die sich auf so etwas stützt, ist geraten.
 *
 * Ein FALSCHES Tempolimit ist schlimmer als gar keines: ein leeres Schild
 * sagt „weiß ich nicht", eine 100 auf einer Landstraße sagt etwas Falsches
 * mit Nachdruck. Deshalb gibt es eine Genauigkeitsschwelle, und deshalb ist
 * sie eine benannte Zahl.
 */

import type { Position } from '@yapaia/shared';

/** Ein Punkt der Fahrtlinie. */
export interface Spurpunkt {
  lat: number;
  lon: number;
  /** Zeitstempel in Millisekunden. */
  ts: number;
}

/**
 * Wie viele Punkte die Spur führt.
 *
 * Genug, um eine Richtung zu zeigen, und wenige genug, dass die Spur nicht
 * über mehrere Straßen reicht: bei 80 km/h und 15 m Mindestabstand sind fünf
 * Punkte rund sechzig Meter — ein Stück Straße, kein Streckenabschnitt.
 */
export const SPUR_LAENGE = 5;

/**
 * Mindestabstand zwischen zwei Punkten der Spur, in Metern.
 *
 * Im Stand liefert das GPS weiter Punkte, die sich nur durch das Rauschen
 * unterscheiden. Eine Spur daraus zeigt in eine zufällige Richtung — und eine
 * zufällige Richtung ist bei der Kartenzuordnung schlimmer als keine.
 */
export const MINDESTABSTAND_M = 15;

/**
 * Wie alt der älteste Punkt höchstens sein darf.
 *
 * Wer eine Minute steht und dann losfährt, soll nicht mit einer Spur von
 * vorhin zugeordnet werden.
 */
export const SPUR_HOECHSTALTER_MS = 60_000;

/**
 * Wie oft höchstens gefragt wird.
 *
 * Positionen kommen im Sekundentakt. Das Tempolimit ändert sich beim Wechsel
 * der Straße, nicht im Sekundentakt — und Valhalla läuft auf demselben
 * kleinen Rechner wie alles andere.
 */
export const ABFRAGE_ABSTAND_MS = 10_000;

/**
 * Ab welcher Ungenauigkeit nicht mehr zugeordnet wird, in Metern.
 *
 * ─── WIE DIE ZAHL ZUSTANDE KOMMT ────────────────────────────────────────────
 * Eine Entscheidung, keine Messung — sie steht deshalb benannt da. Die
 * Größenordnung: eine Autobahn mit Standstreifen ist rund 30 m breit, die
 * Parallelstraße liegt oft 30 bis 50 m daneben. Bei einer Ungenauigkeit in
 * derselben Größenordnung ist die Zuordnung Glückssache.
 *
 * 30 m ist streng genug, um das auszuschließen, und großzügig genug für ein
 * normales Fahrzeug-GPS unter freiem Himmel.
 */
export const HOECHSTE_UNGENAUIGKEIT_M = 30;

/** Entfernung zweier Punkte in Metern (Haversine). */
function abstandM(a: Spurpunkt, b: Spurpunkt): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Taugt diese Position überhaupt als Spurpunkt? */
export function punktTauglich(position: Position | null | undefined): boolean {
  if (!position) return false;
  if (position.fix !== '2d' && position.fix !== '3d') return false;
  if (!Number.isFinite(position.lat) || !Number.isFinite(position.lon)) return false;
  if (position.lat === 0 && position.lon === 0) return false;
  // Eine FEHLENDE Genauigkeitsangabe ist nicht „gut": sie ist unbekannt, und
  // unbekannt heisst hier nicht zuordnen. Ein Tempolimit aus einer Position,
  // deren Güte niemand kennt, ist geraten.
  if (typeof position.accuracy !== 'number' || !Number.isFinite(position.accuracy)) return false;
  return position.accuracy <= HOECHSTE_UNGENAUIGKEIT_M;
}

/**
 * Nimmt einen Punkt in die Spur auf — oder eben nicht.
 *
 * Rein: bekommt die bisherige Spur und gibt die neue zurück. So lässt sich
 * jede Regel einzeln prüfen, ohne Uhr und ohne GPS.
 */
export function spurPflegen(
  bisher: readonly Spurpunkt[],
  neu: Spurpunkt,
  jetzt: number,
): Spurpunkt[] {
  const letzter = bisher[bisher.length - 1];
  // Zu dicht dran: der Punkt bringt keine neue Richtung, nur Rauschen.
  if (letzter && abstandM(letzter, neu) < MINDESTABSTAND_M) return [...bisher];

  const frisch = [...bisher, neu].filter((p) => jetzt - p.ts <= SPUR_HOECHSTALTER_MS);
  return frisch.slice(-SPUR_LAENGE);
}

/**
 * Reicht diese Spur für eine Zuordnung?
 *
 * Mindestens zwei Punkte — sonst gibt es keine Richtung, und genau dafür ist
 * die Spur da.
 */
export function spurBrauchbar(spur: readonly Spurpunkt[], jetzt: number): boolean {
  if (spur.length < 2) return false;
  const juengster = spur[spur.length - 1];
  if (juengster === undefined) return false;
  // Eine Spur, deren NEUESTER Punkt alt ist, beschreibt nicht mehr, wo das
  // Fahrzeug jetzt steht.
  return jetzt - juengster.ts <= SPUR_HOECHSTALTER_MS;
}

/**
 * Der Anfrage-Rumpf für `/trace_attributes` mit einer gefahrenen Spur.
 *
 * ─── `map_snap` UND NICHT `edge_walk` ───────────────────────────────────────
 * `edge_walk` setzt voraus, dass die Punkte EXAKT auf den Kanten liegen. Das
 * gilt für eine von Valhalla selbst gelieferte Routengeometrie (so macht es
 * `buildTraceAttributesBody` für eine fertige Route) — für rohe GPS-Punkte
 * gilt es nie. Sie müssen zugeordnet werden, und das ist `map_snap`.
 */
export function buildSpurBody(
  spur: readonly Spurpunkt[],
  costing: string,
): Record<string, unknown> {
  return {
    shape: spur.map((p) => ({ lat: p.lat, lon: p.lon })),
    costing,
    shape_match: 'map_snap',
    // km/h -- `serialize_speed` skaliert nur bei `miles`.
    units: 'kilometers',
    filters: {
      attributes: ['edge.speed_limit', 'edge.road_class'],
      action: 'include',
    },
  };
}

/** Was an der aktuellen Stelle gilt. */
export interface HierGefunden {
  /** Das ausgeschilderte Limit, oder `null` (unbekannt ODER unbegrenzt). */
  kmh: number | null;
  /** Valhallas Straßenklasse, oder `null`. */
  road_class: string | null;
}

/**
 * Die LETZTE Kante der Antwort — dort steht das Fahrzeug.
 *
 * ─── WARUM DIE LETZTE UND NICHT DIE ERSTE ───────────────────────────────────
 * Die Spur ist die zurückgelegte Strecke; ihr jüngster Punkt ist die aktuelle
 * Position. Die erste Kante ist, wo man vor einer Minute war — und genau dort
 * kann ein anderes Limit gegolten haben. Ein Schild, das die Straße von
 * vorhin zeigt, ist die unangenehmste Sorte Fehler: es stimmt beinahe.
 *
 * Wirft nie. Die Antwort kommt von einem fremden Dienst.
 */
export function limitAusSpurAntwort(
  roh: unknown,
  speedLimitOf: (edge: { speed_limit?: unknown }) => number | null,
  roadClassOf: (edge: { road_class?: unknown }) => string | null,
): HierGefunden | null {
  if (typeof roh !== 'object' || roh === null) return null;
  const kanten = (roh as { edges?: unknown }).edges;
  if (!Array.isArray(kanten) || kanten.length === 0) return null;

  // Rückwärts: die letzte Kante, die überhaupt etwas aussagt. Die allerletzte
  // kann ein Stummel ohne beides sein.
  for (let i = kanten.length - 1; i >= 0; i -= 1) {
    const kante = kanten[i];
    if (!kante || typeof kante !== 'object') continue;
    const kmh = speedLimitOf(kante as { speed_limit?: unknown });
    const road_class = roadClassOf(kante as { road_class?: unknown });
    if (kmh === null && road_class === null) continue;
    return { kmh, road_class };
  }
  return null;
}

/** Ist jetzt wieder eine Abfrage fällig? */
export function abfrageFaellig(zuletztMs: number | null, jetzt: number): boolean {
  if (zuletztMs === null) return true;
  return jetzt - zuletztMs >= ABFRAGE_ABSTAND_MS;
}

/** Eine Position als Spurpunkt, sofern sie taugt. */
export function alsSpurpunkt(position: Position | null | undefined): Spurpunkt | null {
  if (!punktTauglich(position) || !position) return null;
  const ts = Date.parse(position.ts);
  return {
    lat: position.lat,
    lon: position.lon,
    // Ein unlesbarer Zeitstempel darf den Punkt nicht unbrauchbar machen --
    // die Position selbst ist ja gut. Dann gilt „jetzt".
    ts: Number.isFinite(ts) ? ts : Date.now(),
  };
}
