/**
 * Zustand store for favorites + search/destination history (E05-T3).
 * Mirrors `apps/web/src/profiles/store.ts`'s shape: plain reactive state,
 * thin async actions delegating to `./client.js`, optimistic local updates
 * on success.
 */

import { create } from 'zustand';
import type { Favorite, HistoryEntry } from '@yapaja/shared';
import * as client from './client.js';
import type { FavoriteCreateInput, FavoriteUpdateInput, HistoryRecordInput } from './client.js';
import { FavoriteApiError } from './client.js';

export interface FavoritesState {
  favorites: Favorite[];
  history: HistoryEntry[];
  isLoading: boolean;
  error: string | null;

  fetchFavorites: () => Promise<void>;
  createFavorite: (data: FavoriteCreateInput, opts?: { replace?: boolean }) => Promise<Favorite>;
  updateFavorite: (
    id: string,
    data: FavoriteUpdateInput,
    opts?: { replace?: boolean },
  ) => Promise<Favorite>;
  deleteFavorite: (id: string) => Promise<void>;
  /** Persists a full new order (array of favorite ids). Optimistically
   *  reorders local state first so the UI feels instant, then confirms with
   *  the server's canonical result. */
  reorderFavorites: (ids: string[]) => Promise<void>;

  fetchHistory: () => Promise<void>;
  /** Records a history entry. Never throws -- history recording is a
   *  best-effort side effect of search/navigation flows and must not break
   *  them if it fails (e.g. offline hiccup). */
  recordHistory: (input: HistoryRecordInput) => Promise<void>;
  deleteHistoryEntry: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;

  setError: (error: string | null) => void;
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favorites: [],
  history: [],
  isLoading: false,
  error: null,

  fetchFavorites: async () => {
    set({ isLoading: true, error: null });
    try {
      const favorites = await client.fetchFavorites();
      set({ favorites, isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  createFavorite: async (data, opts) => {
    set({ error: null });
    try {
      const favorite = await client.createFavorite(data, opts);
      set((state) => ({
        // A newly-created 'home' favorite may have silently replaced a
        // previous one server-side -- drop any other local 'home' entry so
        // local state can't show two "home" chips until the next refetch.
        favorites: [
          ...state.favorites.filter((f) => !(favorite.category === 'home' && f.category === 'home')),
          favorite,
        ],
      }));
      return favorite;
    } catch (err) {
      if (err instanceof FavoriteApiError) {
        set({ error: err.message });
      }
      throw err;
    }
  },

  updateFavorite: async (id, data, opts) => {
    set({ error: null });
    try {
      const favorite = await client.updateFavorite(id, data, opts);
      set((state) => ({
        favorites: state.favorites
          .filter((f) => !(favorite.category === 'home' && f.category === 'home' && f.id !== favorite.id))
          .map((f) => (f.id === id ? favorite : f)),
      }));
      return favorite;
    } catch (err) {
      if (err instanceof FavoriteApiError) {
        set({ error: err.message });
      }
      throw err;
    }
  },

  deleteFavorite: async (id) => {
    set({ error: null });
    try {
      await client.deleteFavorite(id);
      set((state) => ({ favorites: state.favorites.filter((f) => f.id !== id) }));
    } catch (err) {
      if (err instanceof FavoriteApiError) {
        set({ error: err.message });
      }
      throw err;
    }
  },

  reorderFavorites: async (ids) => {
    const previous = get().favorites;
    const byId = new Map(previous.map((f) => [f.id, f]));
    const optimistic = ids
      .map((id) => byId.get(id))
      .filter((f): f is Favorite => Boolean(f))
      .map((f, index) => ({ ...f, sort_order: index }));
    set({ favorites: optimistic, error: null });

    try {
      const favorites = await client.reorderFavorites(ids);
      set({ favorites });
    } catch (err) {
      // Roll back to the pre-reorder order on failure.
      set({ favorites: previous, error: err instanceof Error ? err.message : 'Sortierung fehlgeschlagen.' });
      throw err;
    }
  },

  fetchHistory: async () => {
    try {
      const history = await client.fetchHistory();
      set({ history });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  recordHistory: async (input) => {
    try {
      const entry = await client.recordHistory(input);
      set((state) => ({ history: [entry, ...state.history] }));
    } catch {
      // Best-effort: never surface a history-recording failure to the user.
    }
  },

  deleteHistoryEntry: async (id) => {
    set({ error: null });
    try {
      await client.deleteHistoryEntry(id);
      set((state) => ({ history: state.history.filter((h) => h.id !== id) }));
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  clearHistory: async () => {
    set({ error: null });
    try {
      await client.clearHistory();
      set({ history: [] });
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  setError: (error) => set({ error }),
}));
