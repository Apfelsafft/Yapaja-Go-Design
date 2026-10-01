/**
 * Position <-> ganze Route, direkt auf dem Bildschirm.
 *
 * Gewünscht: „Ein Button, der zwischen aktueller Position und der gesamten
 * Route wechselt. Der darf gerne bei geplanter oder aktiver Route direkt auf
 * dem Screen liegen. Nicht in einem Menü." Logik in `uebersicht.ts`.
 */

import React from 'react';
import { useRoutingStore, selectActiveRoute } from '../routing/store.js';
import { useNavStore } from '../drive/navStore.js';
import { isDriveActive } from '../drive/driveActive.js';
import { rightStackBottomPx, EDGE_INSET_PX } from '../shell/mapControlLayout.js';
import { useSchmal } from '../shell/useSchmal.js';
import { useUebersichtStore } from './uebersicht.js';

export default function UebersichtButton(): React.ReactElement | null {
  const hatRoute = useRoutingStore((s) => selectActiveRoute(s) !== null);
  const driveActive = isDriveActive(useNavStore((s) => s.navState?.status));
  const schmal = useSchmal();
  const aktiv = useUebersichtStore((s) => s.aktiv);
  const zeigeRoute = useUebersichtStore((s) => s.zeigeRoute);
  const zurPosition = useUebersichtStore((s) => s.zurPosition);

  if (!hatRoute) return null;

  const titel = aktiv ? 'Zurück zur eigenen Position' : 'Ganze Route zeigen';
  return (
    <button
      type="button"
      onClick={() => (aktiv ? zurPosition() : zeigeRoute())}
      aria-pressed={aktiv}
      aria-label={titel}
      title={titel}
      style={{ bottom: rightStackBottomPx('uebersicht', driveActive, schmal), right: EDGE_INSET_PX }}
      className={`fixed z-10 flex h-12 w-12 items-center justify-center rounded-full text-xl shadow-lg ${
        aktiv ? 'bg-blue-600 text-white' : 'bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100'
      }`}
      data-testid="uebersicht-button"
    >
      <span aria-hidden="true">{aktiv ? '📍' : '🗺️'}</span>
    </button>
  );
}
