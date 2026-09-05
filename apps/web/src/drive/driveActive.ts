/**
 * „Laeuft gerade eine Fahrt?" -- als eigenes, komponentenfreies Modul.
 *
 * Die Antwort hing bisher an `ManeuverPanel.tsx`. Wer sie brauchte, musste
 * eine ganze React-Komponente importieren; `mapTapIntent.ts` hat die Liste
 * deshalb kurzerhand abgeschrieben, und die Karten-Knoepfe scheiterten beim
 * Versuch, sie zu importieren.
 *
 * Zwei Kopien derselben Liste sind genau die Sorte Fehler, die spaeter
 * auseinanderlaeuft, ohne dass es auffaellt: ein neuer Fahrzustand kaeme in
 * die eine Liste und in die andere nicht.
 */

import type { NavState } from '@yapaja/shared';

/** Die Zustaende, in denen wirklich gefahren wird. */
export const DRIVE_ACTIVE_STATUSES: ReadonlySet<NavState['status']> = new Set([
  'navigating',
  'off_route',
  'paused',
]);

/** Ob die Fahr-Oberflaeche (Manoeverpanel, Tempolimit, Ansagen) gilt. */
export function isDriveActive(status: NavState['status'] | null | undefined): boolean {
  return status != null && DRIVE_ACTIVE_STATUSES.has(status);
}
