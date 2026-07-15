/**
 * Search bar (E05-T2): search-as-you-type destination search, mounted at
 * the app root like `ProfilesPanel`/`RoutingInitializer`.
 *
 * Placement: top-CENTER. The real top-bar ships with E07; until then this
 * is placed so it clears the two corners that are already taken (see
 * `ProfilesPanel`'s placement comment): top-left has the "Yapaja Go" brand
 * badge + the profile chip (`left-44`), top-right has MapLibre's own
 * zoom/compass `NavigationControl` + `RegionsPanel`. Top-center is free of
 * persistent controls, so that's where this sits.
 *
 * Selecting a result reuses the EXISTING E03-T3 routing flow as-is (never
 * rebuilds the destination pin/bottom sheet): it calls the routing store's
 * `setDestination` (now with an optional display `name`, an additive E05-T2
 * change to `apps/web/src/routing/store.ts`) so `RouteLayer`/`RoutingPanel`
 * pick it up exactly like a map click would, just with a real name instead
 * of only coordinates.
 *
 * Per the project's map-ready ADR (see `RouteLayer`/`DestinationSelector`):
 * the map is read reactively via `useMapStore((s) => s.map)`, never via
 * `mapController.getMap()` inside a `[]`-deps effect. `map.flyTo` here runs
 * inside a plain user-triggered event handler (a result click/Enter), not a
 * mount effect, so the always-current `map` value from this render's hook
 * call is exactly right -- it's guarded with `if (!map) return` regardless.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { SearchResult } from '@yapaja/shared';
import { useMapStore } from '../state/mapStore.js';
import { usePositionStore } from '../position/positionStore.js';
import { useRoutingStore } from '../routing/store.js';
import { formatDistance } from '../routing/format.js';
import { useSearchStore, SEARCH_MIN_CHARS } from './store.js';
import { haversineMeters } from './distance.js';
import { iconForSearchResultType } from './icons.js';
import { friendlySearchErrorMessage } from './errors.js';
import { isSearchSpeedLocked, SEARCH_SPEED_LOCK_KMH } from './speedLock.js';
import { useFavoritesStore } from '../favorites/store.js';

const SEARCH_FLY_TO_ZOOM = 14;
const PANEL_ID = 'search-panel';

export default function SearchBar(): React.ReactElement {
  const query = useSearchStore((state) => state.query);
  const results = useSearchStore((state) => state.results);
  const status = useSearchStore((state) => state.status);
  const error = useSearchStore((state) => state.error);
  const highlightedIndex = useSearchStore((state) => state.highlightedIndex);
  const setQuery = useSearchStore((state) => state.setQuery);
  const moveHighlight = useSearchStore((state) => state.moveHighlight);
  const resetSearch = useSearchStore((state) => state.reset);

  const position = usePositionStore((state) => state.position);
  const setDestination = useRoutingStore((state) => state.setDestination);
  const map = useMapStore((state) => state.map);
  // E05-T3: every selected search result also becomes a Verlauf entry
  // (docs/03 §2 "Verlauf zeichnet Suchen+Ziele auf"). Best-effort -- see
  // `recordHistory`'s own doc comment, it never throws/blocks the selection.
  const recordHistory = useFavoritesStore((state) => state.recordHistory);

  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const speedLocked = isSearchSpeedLocked(position?.speed);

  // The vehicle can start moving WHILE the dropdown is open -- close it
  // (rather than leave a now-untappable list on screen) as soon as the
  // speed lock engages.
  useEffect(() => {
    if (speedLocked) {
      resetSearch();
      setIsFocused(false);
    }
  }, [speedLocked, resetSearch]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      setDestination({ lat: result.latlng.lat, lon: result.latlng.lon }, result.name);
      void recordHistory({
        query: result.name,
        destination: { latlng: result.latlng, name: result.name },
      });
      if (map) {
        map.flyTo({
          center: [result.latlng.lon, result.latlng.lat],
          zoom: SEARCH_FLY_TO_ZOOM,
          essential: true,
        });
      }
      resetSearch();
      setIsFocused(false);
      inputRef.current?.blur();
    },
    [map, setDestination, recordHistory, resetSearch],
  );

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(event.target.value, position ? { lat: position.lat, lon: position.lon } : null);
    },
    [setQuery, position],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (speedLocked) {
        return;
      }
      switch (event.key) {
        case 'ArrowDown':
          if (results.length > 0) {
            event.preventDefault();
            moveHighlight(1);
          }
          break;
        case 'ArrowUp':
          if (results.length > 0) {
            event.preventDefault();
            moveHighlight(-1);
          }
          break;
        case 'Enter': {
          const target = highlightedIndex >= 0 ? results[highlightedIndex] : results[0];
          if (target) {
            event.preventDefault();
            handleSelect(target);
          }
          break;
        }
        case 'Escape':
          event.preventDefault();
          resetSearch();
          inputRef.current?.blur();
          break;
        default:
          break;
      }
    },
    [speedLocked, results, highlightedIndex, moveHighlight, handleSelect, resetSearch],
  );

  const trimmedLength = query.trim().length;
  const showDropdown = isFocused && !speedLocked && trimmedLength >= SEARCH_MIN_CHARS;
  const hasOptions = status === 'success' && results.length > 0;

  let liveMessage = '';
  if (showDropdown) {
    if (status === 'loading') {
      liveMessage = 'Suche läuft…';
    } else if (status === 'error' && error) {
      liveMessage = friendlySearchErrorMessage(error.code, error.message);
    } else if (status === 'success') {
      liveMessage =
        results.length === 0
          ? `Nichts gefunden für ${query.trim()}.`
          : `${results.length} ${results.length === 1 ? 'Ergebnis' : 'Ergebnisse'} gefunden.`;
    }
  }

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-20 w-[min(92vw,26rem)] pointer-events-none">
      <div className="pointer-events-auto relative">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            disabled={speedLocked}
            placeholder="Ziel suchen…"
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls={PANEL_ID}
            aria-autocomplete="list"
            aria-activedescendant={
              showDropdown && highlightedIndex >= 0 ? `search-option-${highlightedIndex}` : undefined
            }
            aria-label="Ziel suchen"
            className="w-full rounded-full bg-white/95 dark:bg-slate-800/95 shadow-md px-4 py-2 pr-9 text-sm text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
            data-testid="search-input"
          />
          <span
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
            aria-hidden="true"
          >
            🔍
          </span>
        </div>

        {speedLocked && (
          <p
            className="mt-1 px-1 text-xs text-amber-700 dark:text-amber-400"
            data-testid="search-speed-lock-hint"
          >
            Suche während der Fahrt gesperrt (&gt; {SEARCH_SPEED_LOCK_KMH} km/h).
          </p>
        )}

        {/* Screen-reader-only live region: announces result-count/empty/error
            state changes as they happen, independent of the visual panel
            below (which some AT users may not "see" the same way). */}
        <span className="sr-only" role="status" aria-live="polite" data-testid="search-status">
          {liveMessage}
        </span>

        {showDropdown && (
          <div
            id={PANEL_ID}
            data-testid="search-panel"
            className="absolute mt-2 w-full rounded-xl bg-white/95 dark:bg-slate-800/95 shadow-xl overflow-hidden text-sm text-slate-800 dark:text-slate-100"
          >
            {status === 'loading' && (
              <p className="px-4 py-3 text-slate-500 dark:text-slate-400" data-testid="search-loading">
                Suche läuft…
              </p>
            )}

            {status === 'error' && error && (
              <p
                className="px-4 py-3 text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30"
                data-testid="search-error"
              >
                {friendlySearchErrorMessage(error.code, error.message)}
              </p>
            )}

            {status === 'success' && results.length === 0 && (
              <div className="px-4 py-3 space-y-1" data-testid="search-empty">
                <p>Nichts gefunden für „{query.trim()}“.</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Prüfe die Schreibweise oder gib Koordinaten ein (z. B. 47.14, 9.52). Die
                  Online-Suche ist derzeit deaktiviert.
                </p>
              </div>
            )}

            {hasOptions && (
              <div role="listbox" id="search-listbox" data-testid="search-results">
                {results.map((result, index) => {
                  const distanceM = position ? haversineMeters(position, result.latlng) : null;
                  const isHighlighted = index === highlightedIndex;
                  return (
                    <div
                      key={`${result.source}-${result.name}-${result.latlng.lat}-${result.latlng.lon}-${index}`}
                      role="option"
                      id={`search-option-${index}`}
                      aria-selected={isHighlighted}
                      data-testid={`search-result-${index}`}
                      // Keeps DOM focus on the input (combobox pattern): a
                      // mousedown that would otherwise blur the input before
                      // the click fires is suppressed here, so tap/click
                      // selection works reliably on touch too.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleSelect(result)}
                      className={`flex items-start gap-2 px-4 py-2 cursor-pointer border-t border-slate-100 dark:border-slate-700 first:border-t-0 ${
                        isHighlighted
                          ? 'bg-blue-50 dark:bg-blue-900/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                      }`}
                    >
                      <span className="text-lg leading-tight flex-shrink-0" aria-hidden="true">
                        {iconForSearchResultType(result.type)}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-medium truncate">{result.name}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">
                          {result.label}
                        </span>
                        {result.out_of_coverage && (
                          <span
                            className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300"
                            data-testid={`search-result-oob-${index}`}
                          >
                            Außerhalb der Kartenabdeckung
                          </span>
                        )}
                      </span>
                      {distanceM !== null && (
                        <span
                          className="flex-shrink-0 text-xs text-slate-500 dark:text-slate-400"
                          data-testid={`search-result-distance-${index}`}
                        >
                          {formatDistance(distanceM)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
