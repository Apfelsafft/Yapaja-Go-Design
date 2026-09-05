/**
 * Wann der Hinweis „diese Masse hat nie jemand bestaetigt" zu zeigen ist --
 * als reine Funktion, damit die Regel pruefbar ist, ohne eine Komponente zu
 * rendern.
 */

import type { VehicleProfile } from '@yapaja/shared';

/**
 * Wahr, solange die Abmessungen des AKTIVEN Profils nie von einem Menschen
 * bestaetigt wurden.
 *
 * `null` beim aktiven Profil (noch nicht geladen) ergibt bewusst `false`:
 * ein Hinweis, der beim Start kurz aufblitzt und wieder verschwindet, wird
 * als Fehler gelesen und nicht als Warnung. Sobald das Profil da ist,
 * entscheidet allein `dimensions_confirmed_at`.
 */
export function needsDimensionConfirmation(profile: VehicleProfile | null): boolean {
  if (!profile) return false;
  return profile.dimensions_confirmed_at === null;
}

/**
 * Die Masse, mit denen tatsaechlich geroutet wird -- als Text fuer den
 * Hinweis.
 *
 * Sie stehen ABSICHTLICH im Hinweis. Eine allgemeine Warnung („bitte Profil
 * pruefen") wird weggeklickt; „3,00 m hoch" ist bei einem 3,20-m-Fahrzeug
 * sofort als falsch zu erkennen. Genau diese eine Zahl ist der Grund fuer
 * die ganze Anzeige.
 */
export function formatDimensions(profile: VehicleProfile): string {
  const m = (value: number): string => value.toFixed(2).replace('.', ',');
  const t = (value: number): string => String(value).replace('.', ',');
  return `${m(profile.height_m)} m hoch · ${m(profile.width_m)} m breit · ${m(profile.length_m)} m lang · ${t(profile.weight_t)} t`;
}
