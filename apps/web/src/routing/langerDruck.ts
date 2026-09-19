/**
 * Langer Druck auf die Karte — erkannt, nicht erhofft.
 *
 * ─── WARUM NICHT EINFACH `contextmenu` ──────────────────────────────────────
 * MapLibre meldet einen langen Fingerdruck oft als `contextmenu`, und
 * `DestinationSelector` hoert darauf auch weiterhin — fuer den Rechtsklick am
 * Schreibtisch ist es der richtige und einzige Weg.
 *
 * Sich allein darauf zu verlassen waere aber genau die Sorte Wette, die
 * diesem Projekt schon mehrfach eine Sackgasse gebaut hat. `contextmenu` ist
 * ein BROWSER-Ereignis: ob es bei Beruehrung kommt, wann es kommt, und ob der
 * Browser stattdessen sein eigenes Auswahl-Menue aufmacht, entscheidet die
 * Anlage des Geraets. Kommt es auf dem Tablet im Fahrerhaus nicht, dann gibt
 * es nach dieser Aenderung ueberhaupt keinen Weg mehr, aus der Karte heraus
 * ein Ziel zu setzen — und der Tipper, der es vorher tat, tut dann nichts
 * mehr. Ein stiller Totalausfall der Zielwahl.
 *
 * Deshalb wird der lange Druck hier SELBST gemessen. `contextmenu` bleibt
 * daneben bestehen; welcher von beiden zuerst kommt, ist gleichgueltig, weil
 * `DestinationSelector` den zweiten innerhalb eines kurzen Fensters verwirft.
 *
 * ─── WARUM UEBER MAPLIBRE UND NICHT UEBER DAS DOM ───────────────────────────
 * Weil MapLibre selbst am besten weiss, wann aus einem Druck ein SCHWENK
 * geworden ist. `movestart` deckt Ziehen, Zoomen, Drehen und Kippen in einem
 * ab — nachgebaut mit Koordinatenvergleichen waere das eine zweite,
 * schlechtere Kopie der Gestenerkennung, die unter dem Finger schon laeuft.
 *
 * Die Bewegungsschwelle steht trotzdem daneben: `movestart` kommt erst, wenn
 * MapLibre die Bewegung als Schwenk ANNIMMT, und bis dahin waere ein
 * zitternder Finger im fahrenden Fahrzeug bereits ein langer Druck an der
 * falschen Stelle.
 */

import type { Map as MapLibreMap, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';

/**
 * Wie lange gedrueckt sein muss, in Millisekunden.
 *
 * 500 ms ist das, was Android und iOS fuer ihren eigenen langen Druck
 * ansetzen — der Wert steckt also bereits in den Fingern. Kuerzer, und ein
 * bedaechtiger Tipper waere schon einer; laenger, und es fuehlt sich an, als
 * haette das Geraet die Beruehrung verschluckt.
 */
export const DRUCKDAUER_MS = 500;

/**
 * Wie weit der Finger dabei wandern darf, in Bildschirmpunkten.
 *
 * Nicht null: eine Hand im fahrenden Fahrzeug haelt nichts auf den Punkt
 * still. Aber deutlich kleiner als `ROUTE_TAP_RADIUS_PX` (18) — jenseits
 * davon ist es ein Wischer und kein Druck.
 */
export const WACKEL_PX = 10;

/** Was der lange Druck meldet — die Teile eines Kartenereignisses, die zaehlen. */
export interface DruckOrt {
  lngLat: { lat: number; lng: number };
  point: { x: number; y: number };
}

type ZeigerEreignis = MapMouseEvent | MapTouchEvent;

function ortVon(e: ZeigerEreignis): DruckOrt | null {
  // Bei mehreren Fingern ist es eine Zoom- oder Drehgeste und kein Druck.
  if ('points' in e && Array.isArray(e.points) && e.points.length > 1) return null;
  const punkt = 'point' in e ? e.point : null;
  if (!punkt || !e.lngLat) return null;
  return { lngLat: { lat: e.lngLat.lat, lng: e.lngLat.lng }, point: { x: punkt.x, y: punkt.y } };
}

function entfernung(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Meldet jeden langen Druck an `beiDruck` und gibt die Abmeldung zurueck.
 *
 * Der Rueckgabewert MUSS im Aufraeumen des Effekts aufgerufen werden: sonst
 * bleibt beim Abbau der Komponente ein Zeitgeber stehen, der auf eine Karte
 * zeigt, die es nicht mehr gibt.
 */
export function langerDruckUeberwachen(
  map: MapLibreMap,
  beiDruck: (ort: DruckOrt) => void,
): () => void {
  let zeitgeber: ReturnType<typeof setTimeout> | null = null;
  let start: DruckOrt | null = null;

  const abbrechen = (): void => {
    if (zeitgeber !== null) {
      clearTimeout(zeitgeber);
      zeitgeber = null;
    }
    start = null;
  };

  const beginnen = (e: ZeigerEreignis): void => {
    abbrechen();
    // Nur die linke Maustaste. Die rechte ist der Rechtsklick, und den
    // behandelt `contextmenu` -- beides zu zaehlen ergaebe zwei Ziele.
    const roh = e.originalEvent as { button?: number } | undefined;
    if (roh && typeof roh.button === 'number' && roh.button !== 0) return;

    const ort = ortVon(e);
    if (!ort) return;
    start = ort;
    zeitgeber = setTimeout(() => {
      zeitgeber = null;
      const gedrueckt = start;
      start = null;
      if (gedrueckt) beiDruck(gedrueckt);
    }, DRUCKDAUER_MS);
  };

  const bewegen = (e: ZeigerEreignis): void => {
    if (!start) return;
    const ort = ortVon(e);
    // Kein auswertbarer Ort (etwa ein zweiter Finger) -- das ist keine
    // Bewegung, die man messen kann, aber ganz sicher kein ruhiger Druck.
    if (!ort || entfernung(ort.point, start.point) > WACKEL_PX) abbrechen();
  };

  /**
   * Abbrechen, aber NUR wenn die Karte sich wegen des Bedienenden bewegt.
   *
   * ─── DER FEHLER, DEN DAS BEHEBT ───────────────────────────────────────────
   * Hier stand `map.on('movestart', abbrechen)` -- ohne diese Unterscheidung.
   * `movestart` meldet aber JEDE Kamerabewegung, auch die, die das Programm
   * selbst auslöst: das Einpassen auf eine neue Route, der Re-Center-Knopf,
   * eine Animation direkt nach dem Laden. Und vor allem Follow-Me, das die
   * Karte im Fahrbetrieb dauernd nachzieht.
   *
   * Damit war der lange Druck ausgerechnet dann nicht durchzubringen, wenn
   * sich auf der Karte gerade etwas tut -- und das ist der Normalfall.
   * Aufgefallen ist es einem Onboarding-Test, in dem eine Animation lief,
   * während der Test drückte. Ohne diesen Test wäre es als „geht manchmal
   * nicht" beim Betreiber gelandet.
   *
   * `originalEvent` ist genau die Unterscheidung: MapLibre setzt es bei
   * einer Geste des Bedienenden und lässt es bei `flyTo`/`easeTo` und
   * Freunden weg.
   *
   * Die Bewegungsschwelle oben bleibt die zweite Reihe: sie fängt das Ziehen
   * direkt am Finger, unabhängig davon, was die Kamera dazu meldet.
   */
  const bewegungBegonnen = (e: unknown): void => {
    const roh = (e as { originalEvent?: unknown } | undefined)?.originalEvent;
    if (roh) abbrechen();
  };

  map.on('mousedown', beginnen);
  map.on('touchstart', beginnen);
  map.on('mousemove', bewegen);
  map.on('touchmove', bewegen);
  map.on('mouseup', abbrechen);
  map.on('touchend', abbrechen);
  map.on('touchcancel', abbrechen);
  map.on('movestart', bewegungBegonnen);

  return () => {
    abbrechen();
    map.off('mousedown', beginnen);
    map.off('touchstart', beginnen);
    map.off('mousemove', bewegen);
    map.off('touchmove', bewegen);
    map.off('mouseup', abbrechen);
    map.off('touchend', abbrechen);
    map.off('touchcancel', abbrechen);
    map.off('movestart', bewegungBegonnen);
  };
}
