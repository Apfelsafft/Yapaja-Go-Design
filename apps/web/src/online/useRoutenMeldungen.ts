/**
 * Die Verkehrsmeldungen auf der aktiven Route -- für Karte und Liste.
 *
 * Beide fragen dasselbe; gerechnet wird je Route und Meldungsstand nur
 * einmal (siehe `entlangDerRoute.ts` für das Warum).
 */

import { useMemo } from 'react';
import { useRoutingStore, selectActiveRoute } from '../routing/store.js';
import { decodePolyline6 } from '../routing/polyline.js';
import { useVerkehrStore } from './verkehrStore.js';
import { meldungenEntlang, routenLinie, type MeldungAufRoute, type RoutenLinie } from './entlangDerRoute.js';
import type { KartenMeldung } from './verkehrGeoJson.js';

let letzte: { geometrie: string; meldungen: readonly KartenMeldung[]; linie: RoutenLinie; entlang: MeldungAufRoute[] } | null =
  null;

function berechnen(geometrie: string, meldungen: readonly KartenMeldung[]): { linie: RoutenLinie; entlang: MeldungAufRoute[] } {
  if (letzte && letzte.geometrie === geometrie && letzte.meldungen === meldungen) return letzte;
  const linie = routenLinie(decodePolyline6(geometrie));
  const entlang = meldungenEntlang(meldungen, linie);
  letzte = { geometrie, meldungen, linie, entlang };
  return letzte;
}

export function useRoutenMeldungen(): { linie: RoutenLinie | null; entlang: MeldungAufRoute[] } {
  const route = useRoutingStore(selectActiveRoute);
  const meldungen = useVerkehrStore((s) => s.meldungen);
  return useMemo(() => {
    if (!route?.geometry || meldungen.length === 0) return { linie: null, entlang: [] };
    return berechnen(route.geometry, meldungen);
  }, [route?.geometry, meldungen]);
}
