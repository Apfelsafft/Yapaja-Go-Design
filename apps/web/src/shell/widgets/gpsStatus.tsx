/**
 * GPS-status widget (E07-T1: "GPS-Status (aus Position.fix/gps-loss)").
 * Reuses `deriveSignalState`'s PURE signal-staleness logic (E02-T5, W-01,
 * `apps/web/src/position/gpsSignal.ts`) rather than reimplementing the
 * "no real fix for >3s counts as lost" threshold -- only the SOURCE of
 * `lastRealUpdateTime` differs: `positionStore.ts` (the pre-existing,
 * separately-connected store) tracks wall-clock RECEIPT time, whereas this
 * widget derives it from the latest `pos/update` payload's own `ts` field
 * (no second store to read receipt time from here -- see `shell/wsStore.ts`'s
 * connection-boundary doc comment). Close enough for a status indicator; the
 * `useGpsSignalState` REACT HOOK itself is intentionally NOT reused since
 * it's hard-wired to `usePositionStore`.
 */

import React, { useEffect, useState } from 'react';
import type { Position } from '@yapaja/shared';
import type { Widget, WidgetRenderContext } from '@yapaja/ui';
import { deriveSignalState, type GpsSignalState } from '../../position/gpsSignal.js';

const LABELS: Record<GpsSignalState, string> = {
  acquiring: 'GPS wird gesucht…',
  live: 'GPS aktiv',
  lost: 'GPS-Signal verloren',
};

const TICK_INTERVAL_MS = 500;

function GpsStatusDisplay({ connected, data }: Pick<WidgetRenderContext, 'connected' | 'data'>): React.ReactElement {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  const realFix = data['pos/update'] as Position | undefined;
  const lastRealUpdateTime = realFix ? new Date(realFix.ts).getTime() : null;
  const state = deriveSignalState({ connected, lastRealUpdateTime, now });
  // Dead-reckoning is in progress (W-01) whenever the real fix has gone
  // stale but a `pos/extrapolated` guess is still standing in for it.
  const deadReckoning = state === 'lost' && Boolean(data['pos/extrapolated']);

  return (
    <div
      data-testid="widget-gps-status-value"
      data-gps-state={state}
      className={`text-xs font-medium ${state === 'lost' ? 'text-red-500' : state === 'live' ? 'text-green-600' : 'text-slate-400'}`}
    >
      {LABELS[state]}
      {deadReckoning ? ' (Schätzung)' : ''}
    </div>
  );
}

export const gpsStatusWidget: Widget = {
  id: 'gps-status',
  name: 'GPS-Status',
  sizes: ['S'],
  topics: ['pos/update', 'pos/extrapolated'],
  render: ({ connected, data }) => <GpsStatusDisplay connected={connected} data={data} />,
};
