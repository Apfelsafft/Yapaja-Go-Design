/**
 * Wo die eigene Position im Bild sitzt -- je Bildschirm einstellbar.
 *
 * Gewünscht: „Wenn man den Bildschirm anpasst, soll man auch die aktuelle
 * Position verschieben können. Also wo sie sich auf der Karte zentriert."
 *
 * Der Anker ist ein Anteil der Kartenbreite und -höhe (0,5 | 0,5 = Mitte).
 * Ohne eigene Einstellung gilt, was vorher fest war: im Ruhemodus die Mitte,
 * während der Fahrt die Mitte des unteren Viertels auf der Fahrerseite
 * (`drivePadding.ts`).
 *
 * Gespeichert wird er in der Anordnung (`shell/anordnung.ts`) unter
 * {@link ANKER_ID} -- dort, wo auch alles andere je Bildschirm liegt. `dx`
 * und `dy` tragen dabei die Anteile, nicht Bildpunkte: „Zurücksetzen" und das
 * Speichern je Gerät gelten so ohne Sonderweg mit.
 */

import { DRIVE_VEHICLE_X, DRIVE_VEHICLE_Y } from './drivePadding.js';
import type { Modus, Platz } from '../shell/anordnung.js';

export const ANKER_ID = 'kartenposition';

/** So weit an den Rand darf der Anker -- ganz am Rand sähe man nur eine Seite. */
export const ANKER_MIN = 0.1;
export const ANKER_MAX = 0.9;

export interface Anker {
  x: number;
  y: number;
}

export interface KartenRaender {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function begrenzeAnker(a: Anker): Anker {
  const b = (v: number): number => Math.min(ANKER_MAX, Math.max(ANKER_MIN, v));
  return { x: b(a.x), y: b(a.y) };
}

export function standardAnker(modus: Modus, einbau: 'lhd' | 'rhd'): Anker {
  return modus === 'fahrt' ? { x: DRIVE_VEHICLE_X[einbau], y: DRIVE_VEHICLE_Y } : { x: 0.5, y: 0.5 };
}

/** Der eingestellte Anker, sonst der Standard. */
export function ankerFuer(
  eintraege: Record<string, Platz> | undefined,
  modus: Modus,
  einbau: 'lhd' | 'rhd',
): Anker {
  const p = eintraege?.[ANKER_ID];
  return p ? begrenzeAnker({ x: p.dx, y: p.dy }) : standardAnker(modus, einbau);
}

/**
 * Die Ränder, mit denen MapLibre die Kartenmitte auf den Anker schiebt.
 *
 * MapLibre setzt die Mitte in die Mitte des Bereichs, der nach Abzug der
 * Ränder bleibt. Soll sie bei y liegen, braucht es oben einen Rand von
 * 2·(y − 0,5) der Höhe (unterhalb der Mitte) bzw. unten 2·(0,5 − y)
 * (oberhalb) -- waagerecht genauso. Dieselbe Rechnung wie
 * `drivePadding.ts#driveRaender`, nur in alle vier Richtungen.
 */
export function ankerRaender(
  breitePx: number | null | undefined,
  hoehePx: number | null | undefined,
  anker: Anker,
): KartenRaender | null {
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (!ok(breitePx) || !ok(hoehePx)) return null;
  const { x, y } = begrenzeAnker(anker);
  const senk = Math.round(hoehePx * 2 * Math.abs(y - 0.5));
  const waag = Math.round(breitePx * 2 * Math.abs(x - 0.5));
  return {
    top: y > 0.5 ? senk : 0,
    bottom: y < 0.5 ? senk : 0,
    left: x > 0.5 ? waag : 0,
    right: x < 0.5 ? waag : 0,
  };
}
