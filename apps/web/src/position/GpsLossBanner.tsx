/**
 * GPS-Loss Banner (E02-T5, W-01)
 *
 * Shows "GPS-Signal verloren" whenever no real GPS fix has arrived for more
 * than 3s while still connected to the Core (see gpsSignal.ts). Styled like
 * GeolocationHints: a `fixed`, `pointer-events-none` overlay container so it
 * never shifts layout, with only the inner card re-enabling pointer events.
 */

import React from 'react';
import { useGpsSignalState } from './gpsSignal';
import { usePositionConnected } from './positionStore';

export default function GpsLossBanner(): React.ReactElement | null {
  const signalState = useGpsSignalState();
  const isConnected = usePositionConnected();

  if (signalState !== 'lost' || !isConnected) {
    return null;
  }

  return (
    <div className="fixed inset-0 pointer-events-none" data-testid="gps-loss-banner-container">
      <div className="absolute top-4 left-4 right-4 pointer-events-auto">
        <div
          className="bg-slate-800/95 dark:bg-slate-900/95 text-white border border-slate-600 rounded-lg p-3 shadow-lg flex items-center gap-3"
          data-testid="gps-loss-banner"
        >
          <div className="flex-shrink-0 text-lg" aria-hidden="true">
            📡
          </div>
          <p className="font-semibold">GPS-Signal verloren</p>
        </div>
      </div>
    </div>
  );
}
