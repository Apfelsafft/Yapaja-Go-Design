/**
 * Zwischenziele: anlegen, sortieren, entfernen.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Bitte fuege die Moeglichkeit von Zwischenzielen ein. Bei Routenplanung
 * bzw. auch waehrend aktiver Navigation soll man Zwischenziele einfuegen und
 * in der Reihenfolge sortieren koennen."
 *
 * ─── WARUM PFEILE UND KEIN ZIEHEN ───────────────────────────────────────────
 * Ziehen-und-Fallenlassen ist am Schreibtisch schoener und im Fahrzeug
 * schlechter: es braucht eine ruhige Hand ueber mehrere Sekunden, es kollidiert
 * mit dem Wischen der Karte, und es laesst sich kaum verlaesslich pruefen.
 * Zwei Pfeile sind ein Tipper, treffen auch bei Bewegung und haben an den
 * Raendern ein eindeutiges Verhalten (nichts).
 *
 * ─── WAS WAEHREND DER FAHRT ANDERS IST ──────────────────────────────────────
 * Nichts an dieser Liste. Der Unterschied steckt im Kartentipper
 * (`mapTapIntent.ts`): der Zwischenziel-Modus gilt auch waehrend der Fahrt,
 * weil man ihn ueber einen eigenen Knopf betritt und das Antippen damit die
 * zweite bewusste Handlung ist.
 */

import React from 'react';
import { useRoutingStore } from './store.js';
import { canMove, MAX_WAYPOINTS, waypointLabel } from './waypoints.js';
import type { RequestRouteParams } from './store.js';

export interface WaypointListProps {
  /**
   * Womit neu berechnet wird, wenn sich die Liste aendert -- oder `null`,
   * wenn (noch) nicht gerechnet werden soll.
   */
  rerouteParams: RequestRouteParams | null;
}

export default function WaypointList({ rerouteParams }: WaypointListProps): React.ReactElement {
  const waypoints = useRoutingStore((state) => state.waypoints);
  const pickTarget = useRoutingStore((state) => state.pickTarget);
  const setPickTarget = useRoutingStore((state) => state.setPickTarget);
  const removeWaypoint = useRoutingStore((state) => state.removeWaypoint);
  const moveWaypoint = useRoutingStore((state) => state.moveWaypoint);

  const voll = waypoints.length >= MAX_WAYPOINTS;
  const waehlt = pickTarget === 'waypoint';

  return (
    <div
      className="rounded-md border border-slate-200 dark:border-slate-700 p-2 space-y-1"
      data-testid="waypoint-section"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
          Zwischenziele
          {waypoints.length > 0 && (
            <span className="ml-1 opacity-70" data-testid="waypoint-count">
              ({waypoints.length})
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setPickTarget(waehlt ? 'destination' : 'waypoint')}
          aria-pressed={waehlt}
          disabled={voll && !waehlt}
          className={
            waehlt
              ? 'text-xs px-2 py-1 rounded-md bg-blue-600 text-white'
              : 'text-xs px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50'
          }
          data-testid="add-waypoint-button"
        >
          {waehlt ? 'Auf Karte tippen…' : 'Zwischenziel'}
        </button>
      </div>

      {waehlt && (
        <p className="text-xs text-blue-700 dark:text-blue-400" data-testid="pick-waypoint-hint">
          Tippe auf die Karte, um ein Zwischenziel anzuhängen. Der nächste Tipp danach
          wählt wieder ein Ziel.
        </p>
      )}

      {voll && (
        <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="waypoint-limit-hint">
          Mehr als {MAX_WAYPOINTS} Zwischenziele nimmt die Routenberechnung nicht an.
        </p>
      )}

      {waypoints.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="waypoint-empty">
          Keine — die Route führt direkt zum Ziel.
        </p>
      ) : (
        <ol className="space-y-1" data-testid="waypoint-list">
          {waypoints.map((waypoint, index) => (
            <li
              key={waypoint.id}
              className="flex items-center gap-1 text-xs"
              data-testid={`waypoint-item-${waypoint.id}`}
            >
              <span className="w-4 shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
                {index + 1}.
              </span>
              <span
                className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200"
                data-testid={`waypoint-label-${waypoint.id}`}
                title={waypointLabel(waypoint)}
              >
                {waypointLabel(waypoint)}
              </span>
              <button
                type="button"
                onClick={() => moveWaypoint(waypoint.id, 'up', rerouteParams)}
                disabled={!canMove(waypoints, waypoint.id, 'up')}
                aria-label={`${waypointLabel(waypoint)} nach oben`}
                className="shrink-0 px-1.5 py-1 rounded border border-slate-300 dark:border-slate-600 disabled:opacity-30"
                data-testid={`waypoint-up-${waypoint.id}`}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveWaypoint(waypoint.id, 'down', rerouteParams)}
                disabled={!canMove(waypoints, waypoint.id, 'down')}
                aria-label={`${waypointLabel(waypoint)} nach unten`}
                className="shrink-0 px-1.5 py-1 rounded border border-slate-300 dark:border-slate-600 disabled:opacity-30"
                data-testid={`waypoint-down-${waypoint.id}`}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => removeWaypoint(waypoint.id, rerouteParams)}
                aria-label={`${waypointLabel(waypoint)} entfernen`}
                className="shrink-0 px-1.5 py-1 rounded border border-slate-300 dark:border-slate-600 text-red-600 dark:text-red-400"
                data-testid={`waypoint-remove-${waypoint.id}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
