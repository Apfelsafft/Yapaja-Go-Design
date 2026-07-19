/**
 * Onboarding step 5: GPS source select + test with live status (E08-T5).
 * Reuses the EXISTING position-source endpoints (`GET /position/sources`,
 * `PUT /position/source`) and the existing `useGpsSignalState()` hook
 * (`position/gpsSignal.ts`, already drives the GPS-loss banner) for the
 * live fix/no-fix indicator -- no parallel status logic here.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useGpsSignalState } from '../../position/gpsSignal.js';
import {
  fetchPositionSources,
  forcePositionSource,
  startSimulatorTestDrive,
  type PositionSourceName,
  type SourceStatus,
} from '../positionClient.js';

const SOURCE_LABELS: Record<PositionSourceName, string> = {
  browser: 'Browser-Standort',
  gpsd: 'USB-GPS (gpsd)',
  simulator: 'Simulator (Testfahrt)',
};

const SIGNAL_LABELS: Record<string, string> = {
  acquiring: 'Suche Signal…',
  live: 'Signal aktiv',
  lost: 'Kein Signal',
};

export default function GpsStep(): React.ReactElement {
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [forced, setForced] = useState<PositionSourceName | null>(null);
  const signalState = useGpsSignalState();

  const refresh = useCallback(async () => {
    const result = await fetchPositionSources();
    setSources(result.sources);
    setForced(result.forced);
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 1000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleSelect = useCallback(
    async (source: PositionSourceName) => {
      await forcePositionSource(source);
      if (source === 'simulator') {
        await startSimulatorTestDrive();
      }
      await refresh();
    },
    [refresh],
  );

  return (
    <div className="space-y-4" data-testid="onboarding-step-gps">
      <div
        className="rounded-md border border-slate-200 dark:border-slate-700 p-3 text-sm flex items-center justify-between"
        data-testid="onboarding-gps-signal-status"
        data-signal-state={signalState}
      >
        <span>Live-Status:</span>
        <span
          className={
            signalState === 'live'
              ? 'text-green-700 dark:text-green-400 font-medium'
              : 'text-slate-500 dark:text-slate-400 font-medium'
          }
        >
          {SIGNAL_LABELS[signalState]}
        </span>
      </div>

      <ul className="space-y-2">
        {sources.map((source) => (
          <li
            key={source.name}
            className="flex items-center justify-between border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-sm"
            data-testid={`onboarding-gps-source-${source.name}`}
          >
            <div>
              <div className="font-medium">{SOURCE_LABELS[source.name]}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {source.active ? 'aktiv' : 'inaktiv'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleSelect(source.name)}
              aria-pressed={forced === source.name}
              className={
                forced === source.name
                  ? 'px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-medium'
                  : 'px-3 py-1.5 rounded-md border border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400 text-xs'
              }
              data-testid={`onboarding-gps-select-${source.name}`}
            >
              {forced === source.name ? 'Ausgewählt & Testen' : 'Wählen & Testen'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
