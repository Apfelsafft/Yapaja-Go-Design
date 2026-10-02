/**
 * Die nächsten fünf Verkehrsmeldungen auf der Route, als Text.
 *
 * Gewünscht: „Können wir die Infos in eine Textbox darstellen? Die Top 5
 * entlang der Route, sortiert nach Abstand zur aktuellen Position."
 *
 * Steht auf der Kartenseite (gegenüber dem Fahrer und dem blauen Punkt),
 * unter dem Tempolimit-Schild. Einklappbar; ob eingeklappt, merkt sich das
 * Gerät.
 */

import React, { useState } from 'react';
import { usePositionStore } from '../position/positionStore.js';
import { useKartenSeite } from '../shell/bedienSeite.js';
import { useSchmal } from '../shell/useSchmal.js';
import { EDGE_INSET_PX, FAB_SIZE_PX, MANEUVER_PANEL_TOP_PX, STACK_GAP_PX } from '../shell/mapControlLayout.js';
import { lageAufRoute, naechsteMeldungen } from './entlangDerRoute.js';
import { useRoutenMeldungen } from './useRoutenMeldungen.js';
import { useAnordnung } from '../shell/useAnordnung.js';

const SCHLUESSEL = 'yapaja.verkehrListeZu';

function liesZu(): boolean {
  try {
    return localStorage.getItem(SCHLUESSEL) === '1';
  } catch {
    return false;
  }
}

function km(m: number): string {
  if (m < 100) return 'jetzt';
  if (m < 1000) return `${Math.round(m / 50) * 50} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0).replace('.', ',')} km`;
}

export default function VerkehrListe(): React.ReactElement | null {
  const anordnung = useAnordnung('verkehr');
  const { linie, entlang } = useRoutenMeldungen();
  const position = usePositionStore((s) => s.position);
  const kartenSeite = useKartenSeite();
  const schmal = useSchmal();
  const [zu, setZu] = useState(liesZu);

  if (!linie || entlang.length === 0) return null;

  const hier = position ? (lageAufRoute(linie, position.lat, position.lon)?.entlang_m ?? 0) : 0;
  const naechste = naechsteMeldungen(entlang, hier, 5);
  if (naechste.length === 0) return null;

  const umschalten = (): void => {
    const neu = !zu;
    setZu(neu);
    try {
      localStorage.setItem(SCHLUESSEL, neu ? '1' : '0');
    } catch {
      // Ohne Speicher bleibt es eben für diese Sitzung.
    }
  };

  return (
    <section
      ref={anordnung.ref}
      aria-label="Verkehr auf der Route"
      data-testid="verkehr-liste"
      className="pointer-events-auto absolute z-20 rounded-xl bg-white/95 text-sm text-slate-800 shadow-lg dark:bg-slate-800/95 dark:text-slate-100"
      style={
        schmal
          ? { left: 8, right: 8, top: MANEUVER_PANEL_TOP_PX + 120 }
          : {
              [kartenSeite]: EDGE_INSET_PX + FAB_SIZE_PX + STACK_GAP_PX,
              top: MANEUVER_PANEL_TOP_PX + 110,
              width: 'min(320px, calc(100% - 160px))',
            }
      }
    >
      <button
        type="button"
        onClick={umschalten}
        aria-expanded={!zu}
        className="flex w-full items-center gap-2 px-3 py-2 text-left font-semibold"
        data-testid="verkehr-liste-kopf"
      >
        <span aria-hidden="true">🚧</span>
        <span className="flex-1">Verkehr auf der Route</span>
        <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
          {zu ? `${naechste.length} · ▾` : '▴'}
        </span>
      </button>
      {!zu && (
        <ol className="max-h-[calc(var(--sicht-h,100vh)*0.45)] divide-y divide-slate-200 overflow-y-auto dark:divide-slate-700">
          {naechste.map(({ meldung: m, voraus_m }) => (
            <li key={m.id} className="px-3 py-2" data-testid={`verkehr-eintrag-${m.id}`}>
              <div className="flex items-baseline gap-2">
                <span aria-hidden="true">{m.art === 'sperrung' ? '⛔' : '🚧'}</span>
                <span className="font-semibold tabular-nums">{km(Math.max(0, voraus_m))}</span>
                <span className="min-w-0 flex-1 truncate">{m.titel}</span>
              </div>
              {m.beschreibung && (
                <p className="line-clamp-2 pl-6 text-xs text-slate-600 dark:text-slate-300">{m.beschreibung}</p>
              )}
            </li>
          ))}
        </ol>
      )}
      {anordnung.griff}
    </section>
  );
}
