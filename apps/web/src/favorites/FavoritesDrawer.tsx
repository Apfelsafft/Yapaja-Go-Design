/**
 * Bottom-drawer (E05-T3, docs/06 §1 mock: "Favoriten ▸ 🏠 Home ⛺ Stellplatz …")
 * with two tabs, Favoriten and Verlauf. Mounted at the app root like
 * `SearchBar`/`ProfilesPanel`.
 *
 * Placement: shares the exact bottom-center footprint `RoutingPanel` (the
 * destination bottom sheet) uses -- the two are mutually exclusive by
 * `destination`: this drawer renders only while there is NO destination
 * (`!destination`), `RoutingPanel` only while there IS one. That mirrors the
 * docs/06 mock (the drawer lives in the plain "Explore-Modus", before a
 * destination/route is active) and avoids any DOM/layout collision without
 * extra z-index bookkeeping.
 *
 * Favoriten tab: tap a chip -> starts a route immediately, using
 * `navigateToFavorite` (see `./navigate.ts` for the CRITICAL "always the
 * CURRENTLY active profile" invariant + its dedicated unit test). Long-press
 * (or the always-visible "⋮" menu button, for touch-timing-independent
 * accessibility/testability) opens rename/delete/reorder controls for that
 * chip. Reordering is exposed as ▲/▼ move controls rather than raw pointer
 * drag-and-drop: both call the exact same persisted `PUT
 * /favorites/reorder` a physical drag gesture would, but ▲/▼ stays reliably
 * usable on a bumpy-road touchscreen (docs/06 §4 "Rüttelpiste") and needs no
 * extra dependency, which a robust cross-input (mouse AND touch) HTML5 drag
 * implementation would.
 *
 * Verlauf tab: tapping an entry re-navigates (destination entries) or
 * re-runs the search (query-only entries); each entry is individually
 * deletable, plus "Verlauf löschen" clears all.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Favorite, HistoryEntry } from '@yapaja/shared';
import { useMapStore } from '../state/mapStore.js';
import { useProfileStore } from '../profiles/store.js';
import { useRoutingStore } from '../routing/store.js';
import { useSearchStore } from '../search/store.js';
import { useFavoritesStore } from './store.js';
import { navigateToFavorite } from './navigate.js';
import { iconForFavoriteCategory } from './icons.js';

const LONG_PRESS_MS = 550;
const FAVORITE_FLY_TO_ZOOM = 14;

type DrawerTab = 'favorites' | 'history';

function historyEntryLabel(entry: HistoryEntry): string {
  return entry.destination?.name ?? entry.query ?? 'Eintrag';
}

export default function FavoritesDrawer(): React.ReactElement | null {
  const destination = useRoutingStore((s) => s.destination);
  const routingSetDestination = useRoutingStore((s) => s.setDestination);
  const requestRoute = useRoutingStore((s) => s.requestRoute);
  const setSearchQuery = useSearchStore((s) => s.setQuery);
  const map = useMapStore((s) => s.map);

  const favorites = useFavoritesStore((s) => s.favorites);
  const history = useFavoritesStore((s) => s.history);
  const fetchFavorites = useFavoritesStore((s) => s.fetchFavorites);
  const fetchHistory = useFavoritesStore((s) => s.fetchHistory);
  const updateFavorite = useFavoritesStore((s) => s.updateFavorite);
  const deleteFavorite = useFavoritesStore((s) => s.deleteFavorite);
  const reorderFavorites = useFavoritesStore((s) => s.reorderFavorites);
  const deleteHistoryEntry = useFavoritesStore((s) => s.deleteHistoryEntry);
  const clearHistory = useFavoritesStore((s) => s.clearHistory);

  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<DrawerTab>('favorites');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void fetchFavorites();
    void fetchHistory();
  }, [fetchFavorites, fetchHistory]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const openEditor = useCallback((fav: Favorite) => {
    setEditingId(fav.id);
    setRenameDraft(fav.name);
    setPendingDeleteId(null);
  }, []);

  const startLongPress = useCallback(
    (fav: Favorite) => {
      cancelLongPress();
      longPressTimer.current = setTimeout(() => {
        longPressTimer.current = null;
        openEditor(fav);
      }, LONG_PRESS_MS);
    },
    [cancelLongPress, openEditor],
  );

  const handleTapFavorite = useCallback(
    async (fav: Favorite) => {
      // A tap that follows a fired long-press must not ALSO start a route
      // (the pointerup after the long-press timer fired is otherwise
      // indistinguishable from a plain short tap).
      if (editingId === fav.id) {
        return;
      }
      await navigateToFavorite(fav);
      if (map) {
        map.flyTo({
          center: [fav.latlng.lon, fav.latlng.lat],
          zoom: FAVORITE_FLY_TO_ZOOM,
          essential: true,
        });
      }
    },
    [editingId, map],
  );

  const handleRenameSave = useCallback(
    async (id: string) => {
      const name = renameDraft.trim();
      if (!name) return;
      await updateFavorite(id, { name });
      setEditingId(null);
    },
    [renameDraft, updateFavorite],
  );

  const handleMove = useCallback(
    (id: string, direction: -1 | 1) => {
      const index = favorites.findIndex((f) => f.id === id);
      if (index === -1) return;
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= favorites.length) return;
      const ids = favorites.map((f) => f.id);
      const [moved] = ids.splice(index, 1);
      ids.splice(newIndex, 0, moved);
      void reorderFavorites(ids);
    },
    [favorites, reorderFavorites],
  );

  const handleDeleteConfirmed = useCallback(
    async (id: string) => {
      await deleteFavorite(id);
      setPendingDeleteId(null);
      setEditingId(null);
    },
    [deleteFavorite],
  );

  const handleTapHistory = useCallback(
    async (entry: HistoryEntry) => {
      if (entry.destination) {
        const { activeProfile } = useProfileStore.getState();
        routingSetDestination(entry.destination.latlng, entry.destination.name);
        await requestRoute({ origin: 'current', profileId: activeProfile?.id });
        if (map) {
          map.flyTo({
            center: [entry.destination.latlng.lon, entry.destination.latlng.lat],
            zoom: FAVORITE_FLY_TO_ZOOM,
            essential: true,
          });
        }
      } else if (entry.query) {
        setSearchQuery(entry.query);
      }
    },
    [routingSetDestination, requestRoute, map, setSearchQuery],
  );

  // RoutingPanel owns this exact footprint while a destination is active
  // (see file-level doc comment) -- mutually exclusive, no overlap.
  if (destination) {
    return null;
  }

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 w-[min(92vw,28rem)] rounded-xl bg-white/95 dark:bg-slate-800/95 shadow-xl text-sm text-slate-800 dark:text-slate-100"
      data-testid="favorites-drawer"
    >
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls="favorites-drawer-content"
        className="w-full flex items-center justify-between px-4 py-3 font-medium min-h-[48px]"
        data-testid="favorites-drawer-toggle"
      >
        <span>⭐ Favoriten &amp; Verlauf</span>
        <span aria-hidden="true">{isOpen ? '▾' : '▴'}</span>
      </button>

      {isOpen && (
        <div id="favorites-drawer-content" className="px-4 pb-4 space-y-3 max-h-[50vh] overflow-y-auto">
          <div className="flex gap-2" role="tablist" aria-label="Favoriten und Verlauf">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'favorites'}
              onClick={() => setTab('favorites')}
              data-testid="favorites-tab-favorites"
              className={
                tab === 'favorites'
                  ? 'px-3 py-1.5 rounded-full text-xs font-medium bg-blue-600 text-white'
                  : 'px-3 py-1.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
              }
            >
              Favoriten
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'history'}
              onClick={() => setTab('history')}
              data-testid="favorites-tab-history"
              className={
                tab === 'history'
                  ? 'px-3 py-1.5 rounded-full text-xs font-medium bg-blue-600 text-white'
                  : 'px-3 py-1.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
              }
            >
              Verlauf
            </button>
          </div>

          {tab === 'favorites' && (
            <div data-testid="favorites-panel">
              {favorites.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="favorites-empty">
                  Noch keine Favoriten. Speichere ein Ziel über „Als Favorit speichern“ im Ziel-Menü.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-2" data-testid="favorites-chip-list">
                  {favorites.map((fav) => {
                    const isEditing = editingId === fav.id;
                    return (
                      <li key={fav.id} className="flex flex-col gap-1" data-testid={`favorite-chip-${fav.id}`}>
                        <div className="flex items-stretch gap-1">
                          <button
                            type="button"
                            onClick={() => void handleTapFavorite(fav)}
                            onPointerDown={() => startLongPress(fav)}
                            onPointerUp={cancelLongPress}
                            onPointerLeave={cancelLongPress}
                            onContextMenu={(e) => e.preventDefault()}
                            className="flex items-center gap-1.5 px-3 py-2 min-h-[48px] rounded-full bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-sm"
                            data-testid={`favorite-chip-button-${fav.id}`}
                          >
                            <span aria-hidden="true">{iconForFavoriteCategory(fav.category)}</span>
                            <span>{fav.name}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => (isEditing ? setEditingId(null) : openEditor(fav))}
                            aria-label={`${fav.name} bearbeiten`}
                            aria-expanded={isEditing}
                            className="px-2 min-h-[48px] min-w-[36px] rounded-full bg-slate-50 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-300"
                            data-testid={`favorite-menu-${fav.id}`}
                          >
                            ⋮
                          </button>
                        </div>

                        {isEditing && (
                          <div
                            className="w-full rounded-lg border border-slate-200 dark:border-slate-600 p-2 space-y-2"
                            data-testid={`favorite-menu-panel-${fav.id}`}
                          >
                            <div className="flex gap-1">
                              <input
                                type="text"
                                value={renameDraft}
                                onChange={(e) => setRenameDraft(e.target.value)}
                                className="flex-1 min-w-0 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                                data-testid={`favorite-rename-input-${fav.id}`}
                              />
                              <button
                                type="button"
                                onClick={() => void handleRenameSave(fav.id)}
                                className="px-2 py-1 rounded bg-blue-600 text-white text-xs"
                                data-testid={`favorite-rename-save-${fav.id}`}
                              >
                                Speichern
                              </button>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleMove(fav.id, -1)}
                                aria-label="Nach oben verschieben"
                                className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 text-xs"
                                data-testid={`favorite-move-up-${fav.id}`}
                              >
                                ▲
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMove(fav.id, 1)}
                                aria-label="Nach unten verschieben"
                                className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-700 text-xs"
                                data-testid={`favorite-move-down-${fav.id}`}
                              >
                                ▼
                              </button>
                              <span className="flex-1" />
                              {pendingDeleteId === fav.id ? (
                                <>
                                  <span className="text-xs text-red-700 dark:text-red-300">Wirklich löschen?</span>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteConfirmed(fav.id)}
                                    className="px-2 py-1 rounded bg-red-600 text-white text-xs"
                                    data-testid={`favorite-delete-confirm-${fav.id}`}
                                  >
                                    Ja
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setPendingDeleteId(fav.id)}
                                  className="px-2 py-1 rounded border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 text-xs"
                                  data-testid={`favorite-delete-${fav.id}`}
                                >
                                  Löschen
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {tab === 'history' && (
            <div data-testid="history-panel">
              {history.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="history-empty">
                  Noch keine Einträge im Verlauf.
                </p>
              ) : (
                <>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void clearHistory()}
                      className="text-xs text-red-700 dark:text-red-300 hover:underline"
                      data-testid="history-clear-all"
                    >
                      Verlauf löschen
                    </button>
                  </div>
                  <ul className="space-y-1" data-testid="history-list">
                    {history.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex items-center justify-between gap-2 rounded-md bg-slate-100 dark:bg-slate-700 px-2 py-1"
                        data-testid={`history-item-${entry.id}`}
                      >
                        <button
                          type="button"
                          onClick={() => void handleTapHistory(entry)}
                          className="flex-1 min-w-0 text-left truncate min-h-[36px]"
                          data-testid={`history-item-button-${entry.id}`}
                        >
                          {historyEntryLabel(entry)}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteHistoryEntry(entry.id)}
                          className="text-xs text-red-700 dark:text-red-300 hover:underline flex-shrink-0"
                          data-testid={`history-delete-${entry.id}`}
                        >
                          Löschen
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
