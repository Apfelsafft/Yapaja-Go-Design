/**
 * Ankunftszeit, Restzeit und Restdistanz waehrend der Fahrt.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Bitte füge bei aktiver Navigation weitere Infos ein. Entfernung,
 * geschätzte Dauer, geschätzte Ankunftszeit."
 *
 * ─── WAS DAFUER GEBAUT WERDEN MUSSTE: NICHTS AN DER BERECHNUNG ──────────────
 * Der Core liefert alle drei Werte seit jeher in `nav/state`
 * (`distance_remaining_m`, `duration_remaining_s`, `eta`), und die
 * Formatierer gibt es auch schon -- sie wurden nur nirgends auf der Karte
 * angezeigt, sondern ausschliesslich als Dashboard-Bausteine
 * (`shell/widgets/{eta,time,distance}.tsx`). Wer kein eigenes Dashboard
 * gebaut hatte, sah sie nie.
 *
 * Dieselbe Formatierung wie dort wird hier WIEDERVERWENDET, nicht
 * nachgebaut: zwei Darstellungen derselben Zahl, die auseinanderlaufen,
 * waeren schlimmer als gar keine zweite Anzeige.
 *
 * ─── WAS „–" BEDEUTET ───────────────────────────────────────────────────────
 * Fehlt ein Wert, steht ein Gedankenstrich. Keine 0, keine Schaetzung: eine
 * erfundene Ankunftszeit ist im Fahrzeug schlechter als eine fehlende, weil
 * man sich danach richtet.
 */

import React from 'react';
import type { NavState } from '@yapaja/shared';
import { formatEta } from '@yapaja/shared';
import { formatDistance, formatDuration } from '../routing/format.js';
import { TRIP_INFO_BOTTOM_PX } from '../shell/mapControlLayout.js';

/** Was angezeigt wird, wenn ein Wert fehlt. */
export const MISSING = '–';

/**
 * Die drei Werte als Text -- rein, damit die Regel ohne Rendern pruefbar ist.
 *
 * `formatEta` kann bei einer unbrauchbaren Zeitangabe von aussen werfen; das
 * darf die Anzeige nicht mitreissen (dieselbe Vorsicht wie im
 * `eta`-Baustein).
 */
export function tripInfoLabels(navState: NavState | null | undefined): {
  distance: string;
  duration: string;
  eta: string;
} {
  const distanceM = navState?.distance_remaining_m;
  const durationS = navState?.duration_remaining_s;
  const eta = navState?.eta;

  let etaLabel = MISSING;
  if (eta) {
    try {
      etaLabel = formatEta(eta);
    } catch {
      etaLabel = MISSING;
    }
  }

  return {
    distance: typeof distanceM === 'number' ? formatDistance(distanceM) : MISSING,
    duration: typeof durationS === 'number' ? formatDuration(durationS) : MISSING,
    eta: etaLabel,
  };
}

interface FieldProps {
  label: string;
  value: string;
  testId: string;
}

function Field({ label, value, testId }: FieldProps): React.ReactElement {
  return (
    <div className="flex flex-col items-center leading-none">
      <span data-testid={testId} className="text-xl font-bold tabular-nums">
        {value}
      </span>
      <span className="mt-1 text-[10px] uppercase tracking-wide text-slate-300">{label}</span>
    </div>
  );
}

export interface TripInfoPanelProps {
  navState: NavState | null | undefined;
}

export default function TripInfoPanel({ navState }: TripInfoPanelProps): React.ReactElement {
  const labels = tripInfoLabels(navState);

  return (
    <div
      data-testid="trip-info-panel"
      style={{ bottom: TRIP_INFO_BOTTOM_PX }}
      // `pointer-events-none`: eine reine Ablesehilfe darf keine Kartengeste
      // abfangen. Waehrend der Fahrt zaehlt jeder Wisch, der ankommt.
      className="pointer-events-none absolute left-1/2 z-20 flex -translate-x-1/2 items-center gap-6 rounded-2xl bg-slate-900/90 px-5 py-2 text-white shadow-lg"
    >
      <Field label="Ankunft" value={labels.eta} testId="trip-info-eta" />
      <Field label="Restzeit" value={labels.duration} testId="trip-info-duration" />
      <Field label="Entfernung" value={labels.distance} testId="trip-info-distance" />
    </div>
  );
}
