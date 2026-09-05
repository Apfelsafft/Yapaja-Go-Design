/**
 * Aus einer Route ein Tempoprofil fuer den Simulator machen.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Bitte fuege einen GPS-Simulator ein, der die gewaehlte Route dann zum Test
 * abfaehrt. Die jeweilige Fahrgeschwindigkeit sollte der entsprechenden
 * Hoechstgeschwindigkeit entsprechen."
 *
 * ─── WAS SCHON DA WAR ───────────────────────────────────────────────────────
 * Der Simulator nimmt seit E02-T4 ein Tempo JE STRECKENABSCHNITT entgegen
 * (`speedsMs`). Und `Route.speed_limits` wird seit dem trace_attributes-Umbau
 * wirklich gefuellt. Es hat nur nie jemand das eine aus dem anderen
 * abgeleitet -- das ist alles, was hier passiert.
 *
 * ─── WARUM DIE INDEX-RECHNUNG NICHT NOCH EINMAL GESCHRIEBEN WIRD ────────────
 * `navigation/instructions.ts` beantwortet die Frage „welches Limit gilt bei
 * Streckenmeter X?" bereits, halboffen je Abschnitt, mit Verteidigung gegen
 * kaputte Indizes von aussen -- und sie ist dort getestet. Eine zweite
 * Rechnung derselben Sache waere genau die Sorte Kopie, die spaeter
 * auseinanderlaeuft: ein Grenzfall wird an einer Stelle korrigiert und an der
 * anderen nicht. Also wird der vorhandene Resolver benutzt, und zwar in der
 * MITTE jedes Abschnitts abgefragt -- so kann die halboffene Grenze
 * ([start, ende)) an keinem der beiden Enden zufaellig danebengreifen.
 *
 * ─── WAS BEI „LIMIT UNBEKANNT" PASSIERT ─────────────────────────────────────
 * Ein Limit kann fehlen: eine Luecke zwischen zwei Abschnitten, oder ein
 * Abschnitt mit `kmh: null` („unbekannt", Valhalla liefert das regelmaessig).
 * Dann wird KEIN Limit erfunden -- die Fahrt braucht aber trotzdem ein Tempo,
 * sonst steht das Fahrzeug fuer immer.
 *
 * Deshalb: ein ausdruecklich uebergebenes Ersatztempo, und die Zahl der so
 * gefuellten Abschnitte kommt als `unknownSegments` mit zurueck. Der Aufrufer
 * kann das anzeigen. Ein still eingesetzter Wert waere hier besonders
 * heikel, weil die Fahrt danach „echt" aussieht.
 */

import type { Route } from '@yapaja/shared';
import { buildRouteGeometry } from '../../navigation/mapMatching.js';
import {
  buildSpeedSegmentAnchors,
  findActiveSpeedLimitKmh,
} from '../../navigation/instructions.js';

/**
 * Ersatztempo, wenn fuer einen Abschnitt kein Limit bekannt ist (km/h).
 *
 * 50 ist die deutsche Regelgeschwindigkeit innerorts und damit die
 * vorsichtige Wahl: lieber zu langsam simulieren als eine Autobahnfahrt
 * vortaeuschen, wo gar keine Daten sind.
 */
export const FALLBACK_SPEED_KMH = 50;

/**
 * Langsamstes Tempo, mit dem ueberhaupt simuliert wird (km/h).
 *
 * Ein Limit von 0 (oder ein negativer Wert aus kaputten Daten) wuerde den
 * Abschnitt unendlich lang machen -- die Wiedergabe bliebe stehen und saehe
 * aus wie ein Absturz.
 */
export const MIN_SPEED_KMH = 5;

export interface RouteSpeedProfile {
  /** Ein Tempo je Streckenabschnitt (m/s), Laenge = Stuetzpunkte - 1. */
  speedsMs: number[];
  /** Wie viele Abschnitte das Ersatztempo bekommen haben. */
  unknownSegments: number;
  /** Wie viele Abschnitte es insgesamt gibt. */
  totalSegments: number;
}

export function kmhToMs(kmh: number): number {
  return (kmh * 1000) / 3600;
}

/**
 * Das Tempoprofil zu einer Route.
 *
 * Wirft bei einer Route ohne brauchbare Geometrie -- und zwar aus
 * `buildRouteGeometry` heraus, das schon auf „weniger als zwei Stuetzpunkte"
 * prueft. Hier stand zunaechst dieselbe Pruefung noch einmal; sie war
 * nachweislich unerreichbar (der Fehler kam immer aus der Ebene darunter).
 * Eine zweite Verteidigung, die nie greift, sieht nur nach Sorgfalt aus.
 */
export function routeSpeedProfile(
  route: Pick<Route, 'geometry' | 'speed_limits'>,
  fallbackKmh: number = FALLBACK_SPEED_KMH,
): RouteSpeedProfile {
  const geom = buildRouteGeometry(route);
  const pointCount = geom.cumulative.length;

  const anchors = buildSpeedSegmentAnchors(route.speed_limits ?? [], geom);

  const speedsMs: number[] = [];
  let unknownSegments = 0;

  for (let i = 0; i < pointCount - 1; i += 1) {
    // Mitte des Abschnitts -- siehe Kopfkommentar: so greift die halboffene
    // Abschnittsgrenze an keinem der beiden Enden daneben.
    const mid = (geom.cumulative[i] + geom.cumulative[i + 1]) / 2;
    const limit = findActiveSpeedLimitKmh(anchors, mid);

    let kmh: number;
    if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
      kmh = limit;
    } else {
      kmh = fallbackKmh;
      unknownSegments += 1;
    }

    speedsMs.push(kmhToMs(Math.max(MIN_SPEED_KMH, kmh)));
  }

  return { speedsMs, unknownSegments, totalSegments: speedsMs.length };
}
