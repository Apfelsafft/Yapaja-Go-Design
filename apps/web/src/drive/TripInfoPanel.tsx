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
import type { NavState } from '@yapaia/shared';
import { formatEta } from '@yapaia/shared';
import { formatDistance, formatDuration } from '../routing/format.js';
import { tripInfoBottomPx } from '../shell/mapControlLayout.js';
import { useSchmal } from '../shell/useSchmal.js';

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
    <div className="flex min-w-0 flex-col items-center leading-none">
      <span data-testid={testId} className="whitespace-nowrap text-lg font-bold tabular-nums sm:text-xl">
        {value}
      </span>
      <span className="mt-1 whitespace-nowrap text-[10px] uppercase tracking-wide text-slate-300">
        {label}
      </span>
    </div>
  );
}

export interface TripInfoPanelProps {
  navState: NavState | null | undefined;
  /** Ob das Fahrtmenue darueber offen ist (`FahrtMenue.tsx`). */
  offen?: boolean;
  /** Antippen oeffnet und schliesst das Fahrtmenue. */
  onToggle?: () => void;
}

/**
 * ─── DIE FAHRTDATEN SIND AUCH DER GRIFF ZUM MENUE ──────────────────────────
 * Gewuenscht: „Wenn das vielleicht hinter den aktuellen fahrtdaten (eta,
 * Uhrzeit, restkilometer) verschachtelt. Also beim klicken auf die Anzeige
 * wird diese Aktion möglich. Analog auch Pause und Stopp der Navigation dar
 * gerne über 2 Klicks erreichbar sein."
 *
 * Deshalb ist die Leiste ein KNOPF. Sie war vorher `pointer-events-none` --
 * eine reine Anzeige, durch die ein Tipp auf die Karte fiel.
 */
export default function TripInfoPanel({ navState, offen = false, onToggle }: TripInfoPanelProps): React.ReactElement {
  const labels = tripInfoLabels(navState);
  const schmal = useSchmal();

  return (
    <button
      type="button"
      data-testid="trip-info-panel"
      aria-expanded={offen}
      aria-controls="fahrt-menue"
      aria-label={`Fahrtmenü ${offen ? 'schließen' : 'öffnen'} — Ankunft ${labels.eta}, Restzeit ${labels.duration}, Entfernung ${labels.distance}`}
      onClick={onToggle}
      style={{ bottom: tripInfoBottomPx() }}
      className={
        (schmal
          ? 'absolute inset-x-2 z-20 flex min-h-[64px] items-center justify-around gap-2 rounded-2xl bg-slate-900/90 px-2 py-2 text-white shadow-lg'
          : 'absolute left-1/2 z-20 flex min-h-[64px] -translate-x-1/2 items-center gap-6 rounded-2xl bg-slate-900/90 px-5 py-2 text-white shadow-lg') +
        (offen ? ' ring-2 ring-blue-400' : '')
      }
    >
      <Field label="Ankunft" value={labels.eta} testId="trip-info-eta" />
      <Field label="Restzeit" value={labels.duration} testId="trip-info-duration" />
      <Field label="Entfernung" value={labels.distance} testId="trip-info-distance" />
      {/* Der Hinweis, dass hier mehr ist -- ohne ihn waere die Leiste von
          der reinen Anzeige vorher nicht zu unterscheiden. */}
      <span aria-hidden="true" className="text-sm text-slate-300">
        {offen ? '▾' : '▴'}
      </span>
    </button>
  );
}
