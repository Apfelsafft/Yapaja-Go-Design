/**
 * Zustand store for search-as-you-type (E05-T2):
 *  - `query`/`results`/`status`/`error`/`highlightedIndex` are plain
 *    reactive state, same shape/spirit as `apps/web/src/routing/store.ts`.
 *  - `setQuery` is the ONE entry point for typing: it debounces 300ms,
 *    only actually sends a request once the (trimmed) query is >= 3
 *    characters, and is race-safe -- an in-flight request is aborted
 *    (`AbortController`) as soon as a newer one starts, AND a monotonic
 *    request sequence number discards any response that arrives after a
 *    newer request has already started (belt-and-suspenders: the sequence
 *    check alone is what actually protects correctness in tests where the
 *    mocked client doesn't itself honor the abort signal).
 *
 * The debounce timer / AbortController / sequence counter are intentionally
 * module-scope (not store state) -- they're imperative bookkeeping, not UI
 * state a component would ever want to react to, exactly like
 * `PositionWSManager`'s private fields in `positionStore.ts`.
 */

import { create } from 'zustand';
import type { LatLng, SearchResult } from '@yapaja/shared';
import * as client from './client.js';
import { SearchApiError } from './client.js';

export type SearchStatus = 'idle' | 'loading' | 'success' | 'error';

export interface SearchStoreError {
  code: string;
  message: string;
}

export interface SearchState {
  query: string;
  results: SearchResult[];
  status: SearchStatus;
  error: SearchStoreError | null;
  /** Index into `results` that's keyboard-highlighted, or -1 for none. */
  highlightedIndex: number;

  /** Sets the raw input text and (re)schedules the debounced search. Always
   *  resets `highlightedIndex`. Fewer than `SEARCH_MIN_CHARS` (trimmed)
   *  cancels any pending/in-flight search and clears results -- no request
   *  is sent. `bias`, when given, is the current position used to bias
   *  results (and is NOT itself part of the debounce key). */
  setQuery: (query: string, bias?: LatLng | null) => void;
  /** Moves the highlight by `delta` (1 = down, -1 = up), wrapping around. */
  moveHighlight: (delta: number) => void;
  setHighlightedIndex: (index: number) => void;
  /** Clears everything and cancels any pending/in-flight search (e.g. Esc,
   *  or after a result was picked). */
  reset: () => void;
}

export const SEARCH_MIN_CHARS = 3;
export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_RESULT_LIMIT = 8;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let inFlightController: AbortController | null = null;
let requestSeq = 0;

function clearPendingDebounce(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

function abortInFlight(): void {
  if (inFlightController) {
    inFlightController.abort();
    inFlightController = null;
  }
}

async function runSearch(q: string, bias: LatLng | null | undefined): Promise<void> {
  abortInFlight();
  const controller = new AbortController();
  inFlightController = controller;
  const seq = ++requestSeq;

  useSearchStore.setState({ status: 'loading', error: null });

  try {
    const results = await client.searchDestinations({
      q,
      limit: SEARCH_RESULT_LIMIT,
      lat: bias?.lat,
      lon: bias?.lon,
      signal: controller.signal,
    });
    // A newer search already started (and thus already invalidated this
    // one via `requestSeq`) -- discard, regardless of arrival order.
    if (seq !== requestSeq) {
      return;
    }
    useSearchStore.setState({ results, status: 'success', error: null });
  } catch (err) {
    if (controller.signal.aborted || seq !== requestSeq) {
      return; // cancelled/superseded, not a real error worth surfacing
    }
    if (err instanceof SearchApiError) {
      useSearchStore.setState({
        status: 'error',
        error: { code: err.code, message: err.message },
        results: [],
      });
    } else if (err instanceof DOMException && err.name === 'AbortError') {
      // Defensive: some environments reject with AbortError without also
      // setting `controller.signal.aborted` synchronously observable above.
      return;
    } else {
      useSearchStore.setState({
        status: 'error',
        error: { code: 'UNKNOWN', message: 'Suche fehlgeschlagen.' },
        results: [],
      });
    }
  } finally {
    if (inFlightController === controller) {
      inFlightController = null;
    }
  }
}

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  results: [],
  status: 'idle',
  error: null,
  highlightedIndex: -1,

  setQuery: (query, bias) => {
    set({ query, highlightedIndex: -1 });
    clearPendingDebounce();

    const trimmed = query.trim();
    if (trimmed.length < SEARCH_MIN_CHARS) {
      abortInFlight();
      set({ results: [], status: 'idle', error: null });
      return;
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runSearch(trimmed, bias);
    }, SEARCH_DEBOUNCE_MS);
  },

  moveHighlight: (delta) => {
    const { results, highlightedIndex } = get();
    if (results.length === 0) {
      return;
    }
    const next = (highlightedIndex + delta + results.length) % results.length;
    set({ highlightedIndex: next });
  },

  setHighlightedIndex: (index) => set({ highlightedIndex: index }),

  reset: () => {
    clearPendingDebounce();
    abortInFlight();
    // Invalidates any still-in-flight response that might resolve later.
    requestSeq += 1;
    set({ query: '', results: [], status: 'idle', error: null, highlightedIndex: -1 });
  },
}));
