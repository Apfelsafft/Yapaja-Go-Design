import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Favorite, HistoryEntry } from '@yapaja/shared';

vi.mock('./client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client.js')>();
  return {
    ...actual,
    fetchFavorites: vi.fn(),
    createFavorite: vi.fn(),
    updateFavorite: vi.fn(),
    deleteFavorite: vi.fn(),
    reorderFavorites: vi.fn(),
    fetchHistory: vi.fn(),
    recordHistory: vi.fn(),
    deleteHistoryEntry: vi.fn(),
    clearHistory: vi.fn(),
  };
});

import { useFavoritesStore } from './store.js';
import * as client from './client.js';
import { FavoriteApiError } from './client.js';

const fetchFavoritesMock = client.fetchFavorites as unknown as ReturnType<typeof vi.fn>;
const createFavoriteMock = client.createFavorite as unknown as ReturnType<typeof vi.fn>;
const updateFavoriteMock = client.updateFavorite as unknown as ReturnType<typeof vi.fn>;
const deleteFavoriteMock = client.deleteFavorite as unknown as ReturnType<typeof vi.fn>;
const reorderFavoritesMock = client.reorderFavorites as unknown as ReturnType<typeof vi.fn>;
const fetchHistoryMock = client.fetchHistory as unknown as ReturnType<typeof vi.fn>;
const recordHistoryMock = client.recordHistory as unknown as ReturnType<typeof vi.fn>;
const deleteHistoryEntryMock = client.deleteHistoryEntry as unknown as ReturnType<typeof vi.fn>;
const clearHistoryMock = client.clearHistory as unknown as ReturnType<typeof vi.fn>;

const INITIAL_STATE = {
  favorites: [],
  history: [],
  isLoading: false,
  error: null,
};

function makeFavorite(overrides: Partial<Favorite> = {}): Favorite {
  return {
    id: 'fav-1',
    name: 'Stellplatz Bodensee',
    latlng: { lat: 47.6, lon: 9.3 },
    icon: 'campsite',
    category: 'campsite',
    sort_order: 0,
    ...overrides,
  };
}

function makeHistoryEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'hist-1',
    query: 'Vaduz',
    destination: null,
    ts: '2026-07-15T10:00:00.000Z',
    ...overrides,
  };
}

describe('favorites store', () => {
  beforeEach(() => {
    useFavoritesStore.setState(INITIAL_STATE);
    fetchFavoritesMock.mockReset();
    createFavoriteMock.mockReset();
    updateFavoriteMock.mockReset();
    deleteFavoriteMock.mockReset();
    reorderFavoritesMock.mockReset();
    fetchHistoryMock.mockReset();
    recordHistoryMock.mockReset();
    deleteHistoryEntryMock.mockReset();
    clearHistoryMock.mockReset();
  });

  describe('fetchFavorites', () => {
    it('loads favorites into state', async () => {
      const favorites = [makeFavorite()];
      fetchFavoritesMock.mockResolvedValue(favorites);

      await useFavoritesStore.getState().fetchFavorites();

      expect(useFavoritesStore.getState().favorites).toEqual(favorites);
      expect(useFavoritesStore.getState().isLoading).toBe(false);
    });
  });

  describe('createFavorite', () => {
    it('appends the created favorite to state', async () => {
      const created = makeFavorite({ id: 'fav-2', name: 'Neu' });
      createFavoriteMock.mockResolvedValue(created);

      const result = await useFavoritesStore.getState().createFavorite({
        name: 'Neu',
        latlng: { lat: 1, lon: 1 },
        icon: 'poi',
        category: 'poi',
      });

      expect(result).toEqual(created);
      expect(useFavoritesStore.getState().favorites).toEqual([created]);
    });

    it('replaces a local "home" favorite when a new one is created (server-side replace)', async () => {
      const oldHome = makeFavorite({ id: 'home-old', category: 'home', name: 'Altes Zuhause' });
      useFavoritesStore.setState({ favorites: [oldHome] });
      const newHome = makeFavorite({ id: 'home-new', category: 'home', name: 'Neues Zuhause' });
      createFavoriteMock.mockResolvedValue(newHome);

      await useFavoritesStore.getState().createFavorite(
        { name: 'Neues Zuhause', latlng: { lat: 1, lon: 1 }, icon: 'home', category: 'home' },
        { replace: true },
      );

      const favorites = useFavoritesStore.getState().favorites;
      expect(favorites).toHaveLength(1);
      expect(favorites[0].id).toBe('home-new');
    });

    it('surfaces a FavoriteApiError (e.g. 409 HOME_ALREADY_EXISTS) via store error and rethrows', async () => {
      createFavoriteMock.mockRejectedValue(
        new FavoriteApiError('HOME_ALREADY_EXISTS', 'A "home" favorite already exists.'),
      );

      await expect(
        useFavoritesStore.getState().createFavorite({
          name: 'Zuhause',
          latlng: { lat: 1, lon: 1 },
          icon: 'home',
          category: 'home',
        }),
      ).rejects.toThrow(FavoriteApiError);

      expect(useFavoritesStore.getState().error).toContain('home');
      expect(useFavoritesStore.getState().favorites).toEqual([]);
    });
  });

  describe('updateFavorite', () => {
    it('replaces the updated favorite in place', async () => {
      const original = makeFavorite();
      useFavoritesStore.setState({ favorites: [original] });
      const updated = { ...original, name: 'Neuer Name' };
      updateFavoriteMock.mockResolvedValue(updated);

      await useFavoritesStore.getState().updateFavorite(original.id, { name: 'Neuer Name' });

      expect(useFavoritesStore.getState().favorites).toEqual([updated]);
    });
  });

  describe('deleteFavorite', () => {
    it('removes the favorite from state', async () => {
      const fav = makeFavorite();
      useFavoritesStore.setState({ favorites: [fav] });
      deleteFavoriteMock.mockResolvedValue(undefined);

      await useFavoritesStore.getState().deleteFavorite(fav.id);

      expect(useFavoritesStore.getState().favorites).toEqual([]);
    });
  });

  describe('reorderFavorites', () => {
    it('optimistically reorders, then confirms with the server result', async () => {
      const a = makeFavorite({ id: 'a', name: 'A', sort_order: 0 });
      const b = makeFavorite({ id: 'b', name: 'B', sort_order: 1 });
      useFavoritesStore.setState({ favorites: [a, b] });

      let resolveServer: (value: Favorite[]) => void = () => {};
      reorderFavoritesMock.mockReturnValue(
        new Promise<Favorite[]>((resolve) => {
          resolveServer = resolve;
        }),
      );

      const promise = useFavoritesStore.getState().reorderFavorites(['b', 'a']);

      // Optimistic update lands synchronously, before the server responds.
      expect(useFavoritesStore.getState().favorites.map((f) => f.id)).toEqual(['b', 'a']);

      resolveServer([
        { ...b, sort_order: 0 },
        { ...a, sort_order: 1 },
      ]);
      await promise;

      expect(useFavoritesStore.getState().favorites.map((f) => f.id)).toEqual(['b', 'a']);
    });

    it('rolls back to the previous order if the server call fails', async () => {
      const a = makeFavorite({ id: 'a', name: 'A', sort_order: 0 });
      const b = makeFavorite({ id: 'b', name: 'B', sort_order: 1 });
      useFavoritesStore.setState({ favorites: [a, b] });
      reorderFavoritesMock.mockRejectedValue(new Error('network error'));

      await expect(useFavoritesStore.getState().reorderFavorites(['b', 'a'])).rejects.toThrow();

      expect(useFavoritesStore.getState().favorites.map((f) => f.id)).toEqual(['a', 'b']);
      expect(useFavoritesStore.getState().error).toBeTruthy();
    });
  });

  describe('history', () => {
    it('fetchHistory loads entries into state', async () => {
      const entries = [makeHistoryEntry()];
      fetchHistoryMock.mockResolvedValue(entries);

      await useFavoritesStore.getState().fetchHistory();

      expect(useFavoritesStore.getState().history).toEqual(entries);
    });

    it('recordHistory prepends the new entry (most-recent-first)', async () => {
      const existing = makeHistoryEntry({ id: 'old' });
      useFavoritesStore.setState({ history: [existing] });
      const created = makeHistoryEntry({ id: 'new', query: 'Ulm' });
      recordHistoryMock.mockResolvedValue(created);

      await useFavoritesStore.getState().recordHistory({ query: 'Ulm' });

      expect(useFavoritesStore.getState().history.map((h) => h.id)).toEqual(['new', 'old']);
    });

    it('recordHistory never throws, even if the API call fails', async () => {
      recordHistoryMock.mockRejectedValue(new Error('boom'));

      await expect(useFavoritesStore.getState().recordHistory({ query: 'x' })).resolves.toBeUndefined();
      expect(useFavoritesStore.getState().history).toEqual([]);
    });

    it('deleteHistoryEntry removes the entry from state', async () => {
      const entry = makeHistoryEntry();
      useFavoritesStore.setState({ history: [entry] });
      deleteHistoryEntryMock.mockResolvedValue(undefined);

      await useFavoritesStore.getState().deleteHistoryEntry(entry.id);

      expect(useFavoritesStore.getState().history).toEqual([]);
    });

    it('clearHistory empties the list', async () => {
      useFavoritesStore.setState({ history: [makeHistoryEntry(), makeHistoryEntry({ id: 'h2' })] });
      clearHistoryMock.mockResolvedValue(undefined);

      await useFavoritesStore.getState().clearHistory();

      expect(useFavoritesStore.getState().history).toEqual([]);
    });
  });
});
