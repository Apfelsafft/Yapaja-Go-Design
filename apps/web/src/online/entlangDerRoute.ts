/**
 * Verkehrsmeldungen, die die Route wirklich betreffen.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Bitte visualisiere nur Meldungen auf oder entlang der Route." Und: „Können
 * wir die Infos in eine Textbox darstellen? Die Top 5 entlang der Route,
 * sortiert nach Abstand zur aktuellen Position."
 *
 * Der Kern fragt je AUTOBAHN, die auf der Route liegt -- und bekommt dann die
 * ganze A 5 von Basel bis Hattenbach, auch wenn man nur zwei Ausfahrten weit
 * darauf fährt. Auf der Karte war das ein gelber Teppich über halb
 * Deutschland.
 *
 * Hier wird jede Meldung auf die Route projiziert: wie weit liegt sie
 * daneben, und wie weit ENTLANG der Route? Was mehr als `MAX_ABSTAND_M`
 * daneben liegt, betrifft die Fahrt nicht.
 *
 * Rechnen in einer flachen Näherung (Längengrad mit cos(Breite) gestaucht).
 * Für Abstände bis wenige Kilometer ist der Fehler kleiner als die Breite
 * einer Autobahn.
 */

import type { KartenMeldung } from './verkehrGeoJson.js';

/** Weiter daneben betrifft eine Meldung die Route nicht (Gegenfahrbahn und
 *  Anschlussstelle liegen innerhalb). */
export const MAX_ABSTAND_M = 600;

/** Was knapp hinter der eigenen Position liegt, ist noch „gerade passiert". */
const HINTER_UNS_M = 200;

const M_PRO_GRAD = 111_320;

export interface RoutenLinie {
  /** [lon, lat] je Stützpunkt. */
  punkte: ReadonlyArray<readonly [number, number]>;
  /** Strecke vom Anfang bis zu diesem Stützpunkt, in Metern. */
  bisHier: number[];
}

export function routenLinie(punkte: ReadonlyArray<readonly [number, number]>): RoutenLinie {
  const bisHier: number[] = [0];
  for (let i = 1; i < punkte.length; i++) {
    const [lon1, lat1] = punkte[i - 1]!;
    const [lon2, lat2] = punkte[i]!;
    const k = Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
    const dx = (lon2 - lon1) * k * M_PRO_GRAD;
    const dy = (lat2 - lat1) * M_PRO_GRAD;
    bisHier.push(bisHier[i - 1]! + Math.hypot(dx, dy));
  }
  return { punkte, bisHier };
}

/** Wo ein Punkt auf der Route liegt: Abstand daneben und Strecke entlang. */
export function lageAufRoute(
  linie: RoutenLinie,
  lat: number,
  lon: number,
): { daneben_m: number; entlang_m: number } | null {
  const { punkte, bisHier } = linie;
  if (punkte.length < 2) return null;
  const k = Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  let entlang = 0;
  for (let i = 1; i < punkte.length; i++) {
    const [lon1, lat1] = punkte[i - 1]!;
    const [lon2, lat2] = punkte[i]!;
    // In Metern, mit dem gesuchten Punkt als Ursprung.
    const ax = (lon1 - lon) * k * M_PRO_GRAD;
    const ay = (lat1 - lat) * M_PRO_GRAD;
    const bx = (lon2 - lon) * k * M_PRO_GRAD;
    const by = (lat2 - lat) * M_PRO_GRAD;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = Math.hypot(px, py);
    if (d < best) {
      best = d;
      entlang = bisHier[i - 1]! + t * (bisHier[i]! - bisHier[i - 1]!);
    }
  }
  return { daneben_m: best, entlang_m: entlang };
}

export interface MeldungAufRoute {
  meldung: KartenMeldung;
  entlang_m: number;
}

/** Nur Meldungen, die auf oder direkt an der Route liegen. */
export function meldungenEntlang(
  meldungen: readonly KartenMeldung[],
  linie: RoutenLinie | null,
): MeldungAufRoute[] {
  if (!linie) return [];
  const raus: MeldungAufRoute[] = [];
  for (const m of meldungen) {
    if (typeof m.lat !== 'number' || typeof m.lon !== 'number') continue;
    const lage = lageAufRoute(linie, m.lat, m.lon);
    if (lage && lage.daneben_m <= MAX_ABSTAND_M) raus.push({ meldung: m, entlang_m: lage.entlang_m });
  }
  return raus;
}

export interface VorausMeldung extends MeldungAufRoute {
  /** Strecke von der eigenen Position bis dorthin, entlang der Route. */
  voraus_m: number;
}

/** Die nächsten `n` Meldungen VOR der eigenen Position, die nächste zuerst. */
export function naechsteMeldungen(
  entlang: readonly MeldungAufRoute[],
  positionEntlang_m: number,
  n = 5,
): VorausMeldung[] {
  return entlang
    .map((e) => ({ ...e, voraus_m: e.entlang_m - positionEntlang_m }))
    .filter((e) => e.voraus_m >= -HINTER_UNS_M)
    .sort((a, b) => a.voraus_m - b.voraus_m)
    .slice(0, n);
}
