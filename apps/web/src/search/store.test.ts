import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SearchResult } from '@yapaja/shared';

vi.mock('./client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client.js')>();
  return {
    ...actual,
    searchDestinations: vi.fn(),
  };
});

import { useSearchStore, SEARCH_MIN_CHARS, SEARCH_DEBOUNCE_MS } from './store.js';
import * as client from './client.js';
import { SearchApiError } from './client.js';

const searchMock = client.searchDestinations as unknown as ReturnType<typeof vi.fn>;

const INITIAL_STATE = {
  query: '',
  results: [],
  status: 'idle' as const,
  error: null,
  highlightedIndex: -1,
};

/** Drains the real (un-faked) microtask queue -- `vi.useFakeTimers()` only
 *  fakes timers, not Promise scheduling, but a chain of
 *  `await client.searchDestinations(...)` inside an async function can take
 *  more than one microtask tick to settle end-to-end, so a single
 *  `await Promise.resolve()` isn't always enough. */
async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

function vaduz(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    name: 'Vaduz',
    label: 'Vaduz, Liechtenstein',
    latlng: { lat: 47.141, lon: 9.5215 },
    type: 'city',
    source: 'photon',
    ...overrides,
  };
}

describe('search store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSearchStore.setState(INITIAL_STATE);
    searchMock.mockReset();
  });

  afterEach(() => {
    // Reset drains any pending debounce timer/AbortController left over from
    // a test so it can't leak a `setTimeout` callback into the NEXT test
    // after fake timers are torn down.
    useSearchStore.getState().reset();
    vi.useRealTimers();
  });

  describe('minimum characters (< 3 -> no request)', () => {
    it('sends no request for 0 characters', () => {
      useSearchStore.getState().setQuery('');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 100);
      expect(searchMock).not.toHaveBeenCalled();
      expect(useSearchStore.getState().status).toBe('idle');
    });

    it(`sends no request for ${SEARCH_MIN_CHARS - 1} characters`, () => {
      useSearchStore.getState().setQuery('Va');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 100);
      expect(searchMock).not.toHaveBeenCalled();
    });

    it('clears stale results once the query drops back under the minimum', () => {
      useSearchStore.setState({ results: [vaduz()], status: 'success' });
      useSearchStore.getState().setQuery('V');
      expect(useSearchStore.getState().results).toEqual([]);
      expect(useSearchStore.getState().status).toBe('idle');
    });
  });

  describe('300ms debounce', () => {
    it(`sends nothing before ${SEARCH_DEBOUNCE_MS}ms have elapsed`, () => {
      searchMock.mockResolvedValue([]);
      useSearchStore.getState().setQuery('Vad');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
      expect(searchMock).not.toHaveBeenCalled();
    });

    it(`sends exactly one request once ${SEARCH_DEBOUNCE_MS}ms have elapsed`, () => {
      searchMock.mockResolvedValue([]);
      useSearchStore.getState().setQuery('Vad');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      expect(searchMock).toHaveBeenCalledTimes(1);
      expect(searchMock).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'Vad', limit: 8 }),
      );
    });

    it('re-typing within the debounce window resets the timer and only sends the LAST text', () => {
      searchMock.mockResolvedValue([]);
      useSearchStore.getState().setQuery('Vad');
      vi.advanceTimersByTime(100);
      useSearchStore.getState().setQuery('Vadu');
      vi.advanceTimersByTime(100);
      useSearchStore.getState().setQuery('Vaduz');
      // Only 100ms have elapsed since the LAST keystroke so far -- nothing sent yet.
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
      expect(searchMock).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(searchMock).toHaveBeenCalledTimes(1);
      expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({ q: 'Vaduz' }));
    });

    it('passes lat/lon bias through when a current position is given', () => {
      searchMock.mockResolvedValue([]);
      useSearchStore.getState().setQuery('Vad', { lat: 47.1, lon: 9.5 });
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      expect(searchMock).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'Vad', lat: 47.1, lon: 9.5 }),
      );
    });

    it('omits lat/lon when no bias is given', () => {
      searchMock.mockResolvedValue([]);
      useSearchStore.getState().setQuery('Vad');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      const call = searchMock.mock.calls[0]?.[0];
      expect(call.lat).toBeUndefined();
      expect(call.lon).toBeUndefined();
    });
  });

  describe('successful search', () => {
    it('sets status=success and stores the results', async () => {
      searchMock.mockResolvedValue([vaduz()]);
      useSearchStore.getState().setQuery('Vad');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      await flushMicrotasks();

      const state = useSearchStore.getState();
      expect(state.status).toBe('success');
      expect(state.results).toEqual([vaduz()]);
      expect(state.error).toBeNull();
    });

    it('an empty result array is still status=success (0-hit "not found" state, not an error)', async () => {
      searchMock.mockResolvedValue([]);
      useSearchStore.getState().setQuery('Vad');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      await flushMicrotasks();

      const state = useSearchStore.getState();
      expect(state.status).toBe('success');
      expect(state.results).toEqual([]);
    });
  });

  describe('backend error', () => {
    it('surfaces a SearchApiError as a typed error and clears stale results', async () => {
      searchMock
        .mockResolvedValueOnce([vaduz()])
        .mockRejectedValueOnce(new SearchApiError('UNKNOWN', 'boom'));

      useSearchStore.getState().setQuery('Vad');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      await flushMicrotasks();
      expect(useSearchStore.getState().results).toEqual([vaduz()]);

      useSearchStore.getState().setQuery('Vaduz');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      await flushMicrotasks();

      const state = useSearchStore.getState();
      expect(state.status).toBe('error');
      expect(state.error).toEqual({ code: 'UNKNOWN', message: 'boom' });
      expect(state.results).toEqual([]);
    });
  });

  describe('race safety: only the LAST request may win', () => {
    it('a later (faster-resolving) request is not clobbered by an earlier, slower one resolving after it', async () => {
      let resolveFirst!: (v: SearchResult[]) => void;
      let resolveSecond!: (v: SearchResult[]) => void;
      const first = new Promise<SearchResult[]>((resolve) => {
        resolveFirst = resolve;
      });
      const second = new Promise<SearchResult[]>((resolve) => {
        resolveSecond = resolve;
      });
      searchMock.mockReturnValueOnce(first).mockReturnValueOnce(second);

      // First search: "Vad" -> debounced request #1 fires.
      useSearchStore.getState().setQuery('Vad');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      expect(searchMock).toHaveBeenCalledTimes(1);

      // User keeps typing; after another full debounce window, request #2
      // fires (request #1 is still pending/unresolved).
      useSearchStore.getState().setQuery('Vaduz');
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      expect(searchMock).toHaveBeenCalledTimes(2);

      // Resolve #2 (the newer, "current" request) FIRST.
      resolveSecond([vaduz({ name: 'Vaduz (aktuell)' })]);
      await flushMicrotasks();
      expect(useSearchStore.getState().results).toEqual([vaduz({ name: 'Vaduz (aktuell)' })]);

      // Now resolve #1 (the stale request) LATE -- it must NOT overwrite
      // the newer result that's already displayed.
      resolveFirst([vaduz({ name: 'Vad (veraltet)' })]);
      await flushMicrotasks();

      const state = useSearchStore.getState();
      expect(state.results).toEqual([vaduz({ name: 'Vaduz (aktuell)' })]);
      expect(state.status).toBe('success');
    });
  });

  describe('moveHighlight / setHighlightedIndex', () => {
    it('wraps around downward past the last result', () => {
      useSearchStore.setState({ results: [vaduz(), vaduz({ name: 'B' })], highlightedIndex: 1 });
      useSearchStore.getState().moveHighlight(1);
      expect(useSearchStore.getState().highlightedIndex).toBe(0);
    });

    it('wraps around upward before the first result', () => {
      useSearchStore.setState({ results: [vaduz(), vaduz({ name: 'B' })], highlightedIndex: 0 });
      useSearchStore.getState().moveHighlight(-1);
      expect(useSearchStore.getState().highlightedIndex).toBe(1);
    });

    it('is a no-op with no results', () => {
      useSearchStore.setState({ results: [], highlightedIndex: -1 });
      useSearchStore.getState().moveHighlight(1);
      expect(useSearchStore.getState().highlightedIndex).toBe(-1);
    });
  });

  describe('reset', () => {
    it('clears query/results/status/error/highlightedIndex and cancels a pending debounce', () => {
      searchMock.mockResolvedValue([vaduz()]);
      useSearchStore.getState().setQuery('Vad');
      useSearchStore.getState().reset();
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 100);

      expect(searchMock).not.toHaveBeenCalled();
      expect(useSearchStore.getState()).toMatchObject(INITIAL_STATE);
    });
  });
});
