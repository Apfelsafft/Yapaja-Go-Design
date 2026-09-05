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
 *
 * E05-T3: also hosts "Als Favorit speichern" -- a small inline form (name +
 * category) that POSTs the current `destination` as a new favorite. Purely
 * additive: no existing testid/behavior above changes. `category: 'home'`
 * colliding with an already-existing home favorite surfaces the Core's 409
 * `HOME_ALREADY_EXISTS` as an inline "ersetzen?" confirmation (docs/03 §2)
 * rather than a raw error.
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { Favorite, RouteAvoidOverrides } from '@yapaja/shared';
import { useMapStore } from '../state/mapStore.js';
import { useProfileStore } from '../profiles/store.js';
import { useUiStore } from '../ui/store.js';
import { useRoutingStore, selectActiveRoute, selectAlternativeRoutes } from './store.js';
import { formatDistance, formatDuration, formatEta } from './format.js';
import { friendlyRoutingErrorMessage } from './errors.js';
import { NAV_ENABLED } from './featureFlags.js';
import { useFavoritesStore } from '../favorites/store.js';
import { FavoriteApiError } from '../favorites/client.js';
import { iconForFavoriteCategory, FAVORITE_CATEGORIES, FAVORITE_CATEGORY_LABELS } from '../favorites/icons.js';
import { startNavigation, NavigationApiError, type StartNavigationReroute } from '../drive/client.js';
import { useNavStore } from '../drive/navStore.js';
import { isDriveActive } from '../drive/ManeuverPanel.js';
import { useOnboardingStore, selectNavigationAllowed } from '../onboarding/store.js';
import WaypointList from './WaypointList.js';
import { toRequestWaypoints } from './waypoints.js';

const AVOID_FLAGS = ['motorway', 'toll', 'ferry', 'unpaved'] as const;
const AVOID_LABELS: Record<(typeof AVOID_FLAGS)[number], string> = {
  motorway: 'Autobahn meiden',
  toll: 'Maut meiden',
  ferry: 'Fähre meiden',
  unpaved: 'Unbefestigt meiden',
};

export default function RoutingPanel(): React.ReactElement | null {
  const destination = useRoutingStore((state) => state.destination);
  const destinationName = useRoutingStore((state) => state.destinationName);
  const routes = useRoutingStore((state) => state.routes);
  const activeRouteId = useRoutingStore((state) => state.activeRouteId);
  const waypoints = useRoutingStore((state) => state.waypoints);
  const status = useRoutingStore((state) => state.status);
  const error = useRoutingStore((state) => state.error);
  const requestRoute = useRoutingStore((state) => state.requestRoute);
  const clear = useRoutingStore((state) => state.clear);
  const avoidOverrides = useRoutingStore((state) => state.avoidOverrides);
  const toggleAvoidOverride = useRoutingStore((state) => state.toggleAvoidOverride);
  const tempAvoidances = useRoutingStore((state) => state.tempAvoidances);
  const removeAvoidance = useRoutingStore((state) => state.removeAvoidance);
  const activeProfile = useProfileStore((state) => state.activeProfile);
  const startPoint = useRoutingStore((state) => state.startPoint);
  const startPointName = useRoutingStore((state) => state.startPointName);
  const pickTarget = useRoutingStore((state) => state.pickTarget);
  const setStartPoint = useRoutingStore((state) => state.setStartPoint);
  const setPickTarget = useRoutingStore((state) => state.setPickTarget);
  // Needed only to know whether the map is ready; the map instance itself
  // isn't touched here (RouteLayer/DestinationSelector own all map access).
  const map = useMapStore((state) => state.map);
  // E04-T5: hidden while a drive session is actually active -- `DriveControls`
  // (pause/resume/stop) takes over the bottom-of-screen real estate then.
  // Reappears once `nav/state` returns to idle/arrived (e.g. after "Stopp"),
  // still showing the SAME route (this store is untouched by starting/
  // stopping navigation) so "Navigation starten" can be pressed again.
  const navStatus = useNavStore((state) => state.navState?.status ?? null);

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

  // E04-T5: "Navigation starten" -- builds the E04-T4 reroute context DIRECTLY
  // from this same routing store (`avoidOverrides` -> `avoid_overrides`,
  // `tempAvoidances` -> `exclude_polygons`, the active profile) so a later
  // auto-reroute reproduces exactly what the user configured here, instead of
  // silently starting a "bare" navigation that would drop them on the first
  // detour.
  const navGateOpen = useNavStore((state) => state.resumeAcknowledged);
  const setNavState = useNavStore((state) => state.setNavState);
  const [navStarting, setNavStarting] = useState(false);
  const [navStartError, setNavStartError] = useState<string | null>(null);

  // E08-T5 disclaimer gate (acceptance criterion #3): navigation must not be
  // startable without a CURRENT-version disclaimer consent recorded in
  // `settings.onboarding_state` -- see `onboarding/store.ts#selectNavigationAllowed`.
  // Reads the SAME onboarding store the wizard itself writes to, so a
  // consent given mid-session (wizard reopened from Settings) unlocks this
  // immediately without a reload.
  const navigationAllowed = useOnboardingStore(selectNavigationAllowed);

  const handleStartNavigation = useCallback(async () => {
    const activeRoute = selectActiveRoute({ routes, activeRouteId });
    if (!activeRoute || !activeProfile || !navigationAllowed) return;

    setNavStarting(true);
    setNavStartError(null);
    try {
      const reroute: StartNavigationReroute = { profile_id: activeProfile.id };
      // Die Zwischenziele mitgeben, damit eine spaetere automatische
      // Neuberechnung sie nicht verliert. Das Feld gab es seit E04-T5 --
      // gefuellt hat es nie jemand, also fiel bei der ersten Abweichung jede
      // Station stillschweigend weg.
      if (waypoints.length > 0) reroute.waypoints = toRequestWaypoints(waypoints);
      if (Object.keys(avoidOverrides).length > 0) reroute.avoid_overrides = avoidOverrides;
      if (tempAvoidances.length > 0) reroute.exclude_polygons = tempAvoidances.map((a) => a.polygon);

      const state = await startNavigation({
        route: activeRoute,
        destination: destination ? { latlng: destination, name: destinationName } : null,
        reroute,
      });
      // Populate the live nav store immediately -- don't wait for the next WS
      // tick (which the WS connection will also deliver, redundantly but
      // harmlessly) before the Drive UI reacts.
      setNavState(state);
    } catch (err) {
      setNavStartError(
        err instanceof NavigationApiError ? err.message : 'Navigation konnte nicht gestartet werden.',
      );
    } finally {
      setNavStarting(false);
    }
  }, [
    routes,
    activeRouteId,
    activeProfile,
    waypoints,
    avoidOverrides,
    tempAvoidances,
    destination,
    destinationName,
    setNavState,
    navigationAllowed,
  ]);

  // E05-T3: "Als Favorit speichern".
  const createFavorite = useFavoritesStore((state) => state.createFavorite);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveCategory, setSaveCategory] = useState<Favorite['category']>('custom');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [homeConflict, setHomeConflict] = useState(false);

  // A newly picked destination resets any leftover form/feedback state from
  // a previous one -- the form is scoped to "this" destination.
  useEffect(() => {
    setShowSaveForm(false);
    setSaveSuccess(false);
    setSaveError(null);
    setHomeConflict(false);
  }, [destination]);

  const handleOpenSaveForm = useCallback(() => {
    setSaveName(destinationName ?? '');
    setSaveCategory('custom');
    setHomeConflict(false);
    setSaveSuccess(false);
    setSaveError(null);
    setShowSaveForm(true);
  }, [destinationName]);

  const handleSaveFavorite = useCallback(
    async (opts: { replace?: boolean } = {}) => {
      if (!destination) return;
      const name = saveName.trim() || 'Favorit';
      try {
        await createFavorite(
          {
            name,
            latlng: destination,
            icon: iconForFavoriteCategory(saveCategory),
            category: saveCategory,
          },
          opts,
        );
        setShowSaveForm(false);
        setHomeConflict(false);
        setSaveSuccess(true);
        setSaveError(null);
      } catch (err) {
        if (err instanceof FavoriteApiError && err.code === 'HOME_ALREADY_EXISTS') {
          setHomeConflict(true);
          return;
        }
        setSaveError(
          err instanceof FavoriteApiError ? err.message : 'Favorit konnte nicht gespeichert werden.',
        );
      }
    },
    [destination, saveName, saveCategory, createFavorite],
  );

  const openRegionsPanel = useUiStore((state) => state.openRegionsPanel);
  const handleOpenRegions = useCallback(() => {
    openRegionsPanel();
  }, [openRegionsPanel]);

  if (!destination || !map) {
    return null;
  }
  if (navGateOpen && isDriveActive(navStatus)) {
    return null;
  }

  const activeRoute = selectActiveRoute({ routes, activeRouteId });
  const alternativeCount = selectAlternativeRoutes({ routes, activeRouteId }).length;

  return (
    <div
      // ─── HOEHE BEGRENZT, INHALT SCROLLT ─────────────────────────────────
      // Dieses Fenster hatte keine Obergrenze: es wuchs mit jedem Abschnitt,
      // den es bekam. Mit den Zwischenzielen (0.5.9) reichte es erstmals
      // ueber die Mitte der Karte -- gemessen bei 1280x720: Oberkante 332,
      // Kartenmitte 360. Ein Doppeltipp auf die Karte landete danach auf dem
      // Fenster statt auf der Karte.
      //
      // Aufgefallen ist es an einem Gesten-Test, aber der Fehler ist aelter
      // als der Anlass: ein Fenster, das unbegrenzt wachsen darf, verdeckt
      // frueher oder spaeter die Karte, um die es geht. 45 % der Hoehe
      // laesst die Mehrheit der Karte frei -- und der Inhalt bleibt ueber
      // das Scrollen vollstaendig erreichbar.
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 w-[min(92vw,28rem)] max-h-[45vh] overflow-y-auto rounded-xl bg-white/95 dark:bg-slate-800/95 shadow-xl p-4 text-sm text-slate-800 dark:text-slate-100 space-y-3"
      data-testid="destination-sheet"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          {/* E05-T2: once a destination was picked via search, show its real
              name here instead of the generic "Ziel" heading -- the
              coordinates line below (`destination-coords`) is UNCHANGED in
              both cases (existing E03-T3 e2e assertions rely on its exact
              format), the name is purely additive. */}
          <h2 className="font-semibold" data-testid="destination-title">
            {destinationName ?? 'Ziel'}
          </h2>
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

      {/* ─── START ────────────────────────────────────────────────────────
          Bis 2026-09-03 gab es diese Zeile nicht: die Oberflaeche konnte nur
          ein ZIEL setzen, der Start war zwangsweise die Live-GPS-Position.
          Wer keine Position hatte -- etwa weil der Browser den Sensor ohne
          HTTPS gar nicht freigibt -- konnte damit keine einzige Route
          berechnen, obwohl Karte und Routinggraph fertig waren.

          Die Voreinstellung bleibt bewusst „aktuelle Position": das ist der
          Normalfall im Fahrzeug, und ein Startpunkt, den man bei jeder Fahrt
          neu setzen muesste, waere eine Verschlechterung. */}
      <div
        className="rounded-md border border-slate-200 dark:border-slate-700 p-2 space-y-1"
        data-testid="route-start-section"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-600 dark:text-slate-300">Start</div>
            {/* Der Name kommt aus den geladenen Vektorkacheln
                (map/placeName.ts). Er ERSETZT die Koordinaten nicht, er
                stellt sich davor: „Bergstrasse" sagt, wohin es geht, die
                Zahlen sagen, welche Stelle genau gemeint ist — und nur die
                zweite Auskunft laesst sich nachpruefen. */}
            {startPoint && startPointName && (
              <p
                className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate"
                data-testid="route-start-name"
              >
                {startPointName}
              </p>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="route-start-value">
              {startPoint
                ? `${startPoint.lat.toFixed(5)}, ${startPoint.lon.toFixed(5)}`
                : 'Aktuelle Position (GPS)'}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setPickTarget(pickTarget === 'origin' ? 'destination' : 'origin')}
              aria-pressed={pickTarget === 'origin'}
              className={
                pickTarget === 'origin'
                  ? 'text-xs px-2 py-1 rounded-md bg-blue-600 text-white'
                  : 'text-xs px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }
              data-testid="pick-start-button"
            >
              {pickTarget === 'origin' ? 'Auf Karte tippen…' : 'Start wählen'}
            </button>
            {startPoint && (
              <button
                type="button"
                onClick={() => setStartPoint(null)}
                className="text-xs px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                data-testid="reset-start-button"
              >
                GPS
              </button>
            )}
          </div>
        </div>
        {pickTarget === 'origin' && (
          <p className="text-xs text-blue-700 dark:text-blue-400" data-testid="pick-start-hint">
            Tippe auf die Karte, um den Startpunkt zu setzen. Der nächste Tipp danach
            wählt wieder ein Ziel.
          </p>
        )}
      </div>

      {/* Zwischenziele direkt unter dem Start: das ist die Reihenfolge, in
          der die Fahrt gelesen wird -- Start, Stationen, Ziel. */}
      <WaypointList
        rerouteParams={activeProfile ? { origin: 'current', profileId: activeProfile.id } : null}
      />

      <div data-testid="save-favorite-section">
        {!showSaveForm && !saveSuccess && (
          <button
            type="button"
            onClick={handleOpenSaveForm}
            className="w-full px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700"
            data-testid="save-as-favorite-button"
          >
            ⭐ Als Favorit speichern
          </button>
        )}

        {saveSuccess && (
          <p className="text-xs text-green-700 dark:text-green-400" data-testid="save-favorite-success">
            Favorit gespeichert.
          </p>
        )}

        {showSaveForm && (
          <div
            className="rounded-md border border-slate-200 dark:border-slate-600 p-2 space-y-2"
            data-testid="save-favorite-form"
          >
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Name"
              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
              data-testid="save-favorite-name-input"
            />
            <select
              value={saveCategory}
              onChange={(e) => setSaveCategory(e.target.value as Favorite['category'])}
              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
              data-testid="save-favorite-category-select"
            >
              {FAVORITE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {FAVORITE_CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>

            {saveError && (
              <p className="text-xs text-red-700 dark:text-red-300" data-testid="save-favorite-error">
                {saveError}
              </p>
            )}

            {homeConflict && (
              <div
                className="rounded bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 p-2 space-y-1"
                data-testid="save-favorite-home-conflict"
              >
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Es existiert bereits ein „Zuhause“-Favorit. Ersetzen?
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSaveFavorite({ replace: true })}
                    className="px-2 py-1 rounded bg-amber-600 text-white text-xs"
                    data-testid="save-favorite-home-replace-button"
                  >
                    Ersetzen
                  </button>
                  <button
                    type="button"
                    onClick={() => setHomeConflict(false)}
                    className="px-2 py-1 rounded border border-slate-300 dark:border-slate-600 text-xs"
                    data-testid="save-favorite-home-cancel-button"
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleSaveFavorite()}
                className="flex-1 px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-medium"
                data-testid="save-favorite-confirm-button"
              >
                Speichern
              </button>
              <button
                type="button"
                onClick={() => setShowSaveForm(false)}
                className="px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 text-xs"
                data-testid="save-favorite-cancel-button"
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}
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
          {error.code === 'OUT_OF_COVERAGE' ? (
            <button
              onClick={handleOpenRegions}
              className="w-full px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium"
              data-testid="route-open-regions-button"
            >
              Regionen verwalten
            </button>
          ) : activeProfile ? (
            <button
              onClick={handleRequestRoute}
              className="w-full px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium"
              data-testid="route-retry-button"
            >
              Erneut versuchen
            </button>
          ) : null}
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
            onClick={() => void handleStartNavigation()}
            disabled={!NAV_ENABLED || navStarting || !navigationAllowed}
            title={
              !NAV_ENABLED
                ? 'Navigation nicht verfügbar'
                : !navigationAllowed
                  ? 'Bitte zuerst den Haftungsausschluss im Setup-Assistenten akzeptieren'
                  : undefined
            }
            className={
              NAV_ENABLED
                ? 'w-full px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium disabled:opacity-50'
                : 'w-full px-4 py-2 rounded-md bg-slate-300 dark:bg-slate-600 text-slate-600 dark:text-slate-300 text-sm font-medium cursor-not-allowed'
            }
            data-testid="start-navigation-button"
            data-disclaimer-gated={!navigationAllowed}
          >
            {navStarting ? 'Navigation wird gestartet…' : 'Navigation starten'}
          </button>
          {!navigationAllowed && (
            <p
              className="text-xs text-amber-700 dark:text-amber-400"
              data-testid="start-navigation-disclaimer-gate"
            >
              Bitte zuerst den Haftungsausschluss im Setup-Assistenten akzeptieren.
            </p>
          )}
          {navStartError && (
            <p
              className="rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2 text-xs"
              data-testid="start-navigation-error"
            >
              {navStartError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
