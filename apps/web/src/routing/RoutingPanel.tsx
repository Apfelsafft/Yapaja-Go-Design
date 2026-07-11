/**
 * Routing bottom sheet (E03-T3): destination pin summary + "Route hierhin",
 * and -- once a route is computed -- the route summary (distance/duration/
 * ETA/profile), warnings banner (W-08), and the (E04-gated, disabled)
 * "Navigation starten" button.
 */

import React, { useCallback } from 'react';
import { useMapStore } from '../state/mapStore.js';
import { useProfileStore } from '../profiles/store.js';
import { useRoutingStore, selectActiveRoute, selectAlternativeRoutes } from './store.js';
import { formatDistance, formatDuration, formatEta } from './format.js';
import { friendlyRoutingErrorMessage } from './errors.js';
import { NAV_ENABLED } from './featureFlags.js';

export default function RoutingPanel(): React.ReactElement | null {
  const destination = useRoutingStore((state) => state.destination);
  const routes = useRoutingStore((state) => state.routes);
  const activeRouteId = useRoutingStore((state) => state.activeRouteId);
  const status = useRoutingStore((state) => state.status);
  const error = useRoutingStore((state) => state.error);
  const requestRoute = useRoutingStore((state) => state.requestRoute);
  const clear = useRoutingStore((state) => state.clear);
  const activeProfile = useProfileStore((state) => state.activeProfile);
  // Needed only to know whether the map is ready; the map instance itself
  // isn't touched here (RouteLayer/DestinationSelector own all map access).
  const map = useMapStore((state) => state.map);

  const handleRequestRoute = useCallback(() => {
    void requestRoute({ origin: 'current', profileId: activeProfile?.id });
  }, [requestRoute, activeProfile]);

  if (!destination || !map) {
    return null;
  }

  const activeRoute = selectActiveRoute({ routes, activeRouteId });
  const alternativeCount = selectAlternativeRoutes({ routes, activeRouteId }).length;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 w-[min(92vw,28rem)] rounded-xl bg-white/95 dark:bg-slate-800/95 shadow-xl p-4 text-sm text-slate-800 dark:text-slate-100 space-y-3"
      data-testid="destination-sheet"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Ziel</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="destination-coords">
            {destination.lat.toFixed(5)}, {destination.lon.toFixed(5)}
          </p>
        </div>
        <button
          onClick={clear}
          className="text-xs px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          data-testid="destination-cancel-button"
        >
          Abbrechen
        </button>
      </div>

      {status === 'idle' && (
        <>
          {!activeProfile && (
            <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="no-active-profile-hint">
              Kein Fahrzeugprofil aktiv. Bitte zuerst ein Profil auswählen.
            </p>
          )}
          <button
            onClick={handleRequestRoute}
            disabled={!activeProfile}
            title={!activeProfile ? 'Kein Fahrzeugprofil aktiv' : undefined}
            className="w-full px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
            data-testid="route-here-button"
          >
            Route hierhin
          </button>
        </>
      )}

      {status === 'loading' && (
        <p className="text-slate-500 dark:text-slate-400" data-testid="route-loading">
          Route wird berechnet…
        </p>
      )}

      {status === 'error' && error && (
        <div className="space-y-2">
          <p
            className="rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2 text-xs"
            data-testid="route-error"
          >
            {friendlyRoutingErrorMessage(error.code, error.message)}
          </p>
          {activeProfile && (
            <button
              onClick={handleRequestRoute}
              className="w-full px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium"
              data-testid="route-retry-button"
            >
              Erneut versuchen
            </button>
          )}
        </div>
      )}

      {status === 'success' && activeRoute && (
        <div className="space-y-3" data-testid="route-summary-panel">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Distanz</div>
              <div className="font-semibold" data-testid="route-distance">
                {formatDistance(activeRoute.distance_m)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Dauer</div>
              <div className="font-semibold" data-testid="route-duration">
                {formatDuration(activeRoute.duration_s)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Ankunft</div>
              <div className="font-semibold" data-testid="route-eta">
                {formatEta(Date.now(), activeRoute.duration_s)}
              </div>
            </div>
          </div>

          {activeProfile && (
            <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="route-profile-hint">
              Profil: {activeProfile.name} · {activeProfile.height_m.toFixed(2)} m H ·{' '}
              {activeProfile.width_m.toFixed(2)} m B · {activeProfile.length_m.toFixed(2)} m L ·{' '}
              {activeProfile.weight_t.toFixed(1)} t G
            </p>
          )}

          {alternativeCount > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="route-alternatives-hint">
              {alternativeCount} {alternativeCount === 1 ? 'Alternative' : 'Alternativen'} verfügbar – auf der Karte
              antippen, um zu wechseln.
            </p>
          )}

          {activeRoute.warnings.length > 0 && (
            <div
              className="rounded-md bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-300 px-3 py-2 text-xs space-y-1"
              data-testid="route-warnings"
            >
              {activeRoute.warnings.map((warning, i) => (
                <p key={`${warning.code}-${i}`} data-testid={`route-warning-${warning.code}`}>
                  {warning.message}
                </p>
              ))}
            </div>
          )}

          <button
            disabled={!NAV_ENABLED}
            title="kommt mit E04"
            className="w-full px-4 py-2 rounded-md bg-slate-300 dark:bg-slate-600 text-slate-600 dark:text-slate-300 text-sm font-medium cursor-not-allowed"
            data-testid="start-navigation-button"
          >
            Navigation starten
          </button>
        </div>
      )}
    </div>
  );
}
