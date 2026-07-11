/**
 * Routing bottom sheet (E03-T3): destination pin summary + "Route hierhin",
 * and -- once a route is computed -- the route summary (distance/duration/
 * ETA/profile), warnings banner (W-08), and the (E04-gated, disabled)
 * "Navigation starten" button.
 *
 * E03-T4: also hosts the 4 avoid-chip toggles (per-route profile overrides,
 * never persisted to the profile) and the manageable list of temporary
 * "Diesen Abschnitt meiden" avoidances (session-scoped, added via
 * `DestinationSelector`'s contextmenu handler on a rendered route). Both are
 * shown as soon as a destination is picked (not gated on `status ===
 * 'success'`) so they stay usable/removable even while loading or after an
 * error -- e.g. removing an avoidance that caused a `NO_ROUTES` error.
 */

import React, { useCallback } from 'react';
import type { RouteAvoidOverrides } from '@yapaja/shared';
import { useMapStore } from '../state/mapStore.js';
import { useProfileStore } from '../profiles/store.js';
import { useRoutingStore, selectActiveRoute, selectAlternativeRoutes } from './store.js';
import { formatDistance, formatDuration, formatEta } from './format.js';
import { friendlyRoutingErrorMessage } from './errors.js';
import { NAV_ENABLED } from './featureFlags.js';

const AVOID_FLAGS = ['motorway', 'toll', 'ferry', 'unpaved'] as const;
const AVOID_LABELS: Record<(typeof AVOID_FLAGS)[number], string> = {
  motorway: 'Autobahn meiden',
  toll: 'Maut meiden',
  ferry: 'Fähre meiden',
  unpaved: 'Unbefestigt meiden',
};

export default function RoutingPanel(): React.ReactElement | null {
  const destination = useRoutingStore((state) => state.destination);
  const routes = useRoutingStore((state) => state.routes);
  const activeRouteId = useRoutingStore((state) => state.activeRouteId);
  const status = useRoutingStore((state) => state.status);
  const error = useRoutingStore((state) => state.error);
  const requestRoute = useRoutingStore((state) => state.requestRoute);
  const clear = useRoutingStore((state) => state.clear);
  const avoidOverrides = useRoutingStore((state) => state.avoidOverrides);
  const toggleAvoidOverride = useRoutingStore((state) => state.toggleAvoidOverride);
  const tempAvoidances = useRoutingStore((state) => state.tempAvoidances);
  const removeAvoidance = useRoutingStore((state) => state.removeAvoidance);
  const activeProfile = useProfileStore((state) => state.activeProfile);
  // Needed only to know whether the map is ready; the map instance itself
  // isn't touched here (RouteLayer/DestinationSelector own all map access).
  const map = useMapStore((state) => state.map);

  const handleRequestRoute = useCallback(() => {
    void requestRoute({ origin: 'current', profileId: activeProfile?.id });
  }, [requestRoute, activeProfile]);

  const handleToggleAvoid = useCallback(
    (flag: keyof RouteAvoidOverrides) => {
      if (!activeProfile) return;
      toggleAvoidOverride(flag, activeProfile.avoid[flag], {
        origin: 'current',
        profileId: activeProfile.id,
      });
    },
    [toggleAvoidOverride, activeProfile],
  );

  const handleRemoveAvoidance = useCallback(
    (id: string) => {
      removeAvoidance(id, { origin: 'current', profileId: activeProfile?.id });
    },
    [removeAvoidance, activeProfile],
  );

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

      {activeProfile && (
        <div className="flex flex-wrap gap-2" data-testid="avoid-chip-group">
          {AVOID_FLAGS.map((flag) => {
            const effective = avoidOverrides[flag] ?? activeProfile.avoid[flag];
            return (
              <button
                key={flag}
                type="button"
                onClick={() => handleToggleAvoid(flag)}
                aria-pressed={effective}
                data-testid={`avoid-chip-${flag}`}
                className={
                  effective
                    ? 'px-3 py-1 rounded-full text-xs font-medium bg-blue-600 text-white border border-blue-600'
                    : 'px-3 py-1 rounded-full text-xs font-medium bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600'
                }
              >
                {AVOID_LABELS[flag]}
              </button>
            );
          })}
        </div>
      )}

      {tempAvoidances.length > 0 && (
        <div className="space-y-1" data-testid="avoid-list">
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Temporäre Vermeidungen
          </h3>
          <ul className="space-y-1">
            {tempAvoidances.map((avoidance, i) => (
              <li
                key={avoidance.id}
                className="flex items-center justify-between text-xs bg-slate-100 dark:bg-slate-700 rounded-md px-2 py-1"
                data-testid={`avoid-list-item-${avoidance.id}`}
              >
                <span>Abschnitt {i + 1} gemieden</span>
                <button
                  type="button"
                  onClick={() => handleRemoveAvoidance(avoidance.id)}
                  className="text-red-600 dark:text-red-400 hover:underline"
                  data-testid={`avoid-list-remove-${avoidance.id}`}
                >
                  Entfernen
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

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
