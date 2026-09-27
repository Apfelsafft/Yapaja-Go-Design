/**
 * Ob gerade die FAHRANSICHT gilt -- dieselbe Bedingung, unter der das
 * Manöver-Panel erscheint (`ManeuverPanel.tsx`): eine laufende, pausierte
 * oder abgewichene Fahrt, deren „Navigation fortsetzen?" beantwortet ist.
 *
 * ─── WOFÜR ──────────────────────────────────────────────────────────────────
 * „wir haben so viele tolle Informationen dass man während der Fahrt zu viele
 * Dinge sieht. […] Hier sollten wir aufräumen was man beim jeweiligen Status
 * wirklich braucht."
 *
 * Alles, was während der Fahrt verschwindet (Kopfzeile, Favoriten-Schublade,
 * die Panel-Knöpfe am rechten Rand), fragt DIESE Funktion. Eine eigene
 * Abfrage je Bauteil liefe früher oder später auseinander -- und dann stünde
 * während der Fahrt die halbe Oberfläche noch da.
 */

import { useNavStore } from './navStore.js';
import { isDriveActive } from './driveActive.js';

export function useFahrtAnsicht(): boolean {
  const status = useNavStore((state) => state.navState?.status ?? null);
  const gate = useNavStore((state) => state.resumeAcknowledged);
  return gate && isDriveActive(status);
}
