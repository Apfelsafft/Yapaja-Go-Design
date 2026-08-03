/**
 * Unit tests for `runWhenStyleReady` (E10-T1).
 *
 * The regression that matters is the FIRST test: a map whose `load` event has
 * ALREADY fired (and whose `isStyleLoaded()` still reports `false`, which
 * MapLibre does whenever a tile/image manager is unfinished) must still get
 * its layers installed. The previous `isStyleLoaded() ? setup() :
 * map.once('load', setup)` guard installed nothing at all in that state --
 * see `styleReady.ts` for the full root-cause write-up.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { runWhenStyleReady, STYLE_NOT_LOADED_MESSAGE } from './styleReady.js';

type Listener = () => void;

interface FakeMap {
  map: MapLibreMap;
  /** Emits a MapLibre event to all listeners registered for it. */
  emit(event: 'styledata' | 'load'): void;
  listenerCount(event: string): number;
}

function createFakeMap(): FakeMap {
  const listeners = new Map<string, Set<Listener>>();
  const map = {
    on(event: string, listener: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return map;
    },
    off(event: string, listener: Listener) {
      listeners.get(event)?.delete(listener);
      return map;
    },
  } as unknown as MapLibreMap;

  return {
    map,
    emit: (event) => {
      for (const listener of [...(listeners.get(event) ?? [])]) listener();
    },
    listenerCount: (event) => listeners.get(event)?.size ?? 0,
  };
}

function styleNotLoadedError(): Error {
  return new Error(STYLE_NOT_LOADED_MESSAGE);
}

describe('runWhenStyleReady', () => {
  it('installs immediately when the style already accepts layers (the missed-`load` case)', () => {
    const { map } = createFakeMap();
    const setup = vi.fn();

    runWhenStyleReady(map, setup);

    // No event needed: this is exactly the state the old guard dropped --
    // `load` long gone, `isStyleLoaded()` still false, style actually ready.
    expect(setup).toHaveBeenCalledTimes(1);
  });

  it('retries on styledata when the style is genuinely not loaded yet', () => {
    const { map, emit } = createFakeMap();
    let ready = false;
    const setup = vi.fn(() => {
      if (!ready) throw styleNotLoadedError();
    });

    runWhenStyleReady(map, setup);
    expect(setup).toHaveBeenCalledTimes(1); // attempted, rejected, swallowed

    emit('styledata'); // still not ready
    expect(setup).toHaveBeenCalledTimes(2);

    ready = true;
    emit('styledata');
    expect(setup).toHaveBeenCalledTimes(3);
    expect(() => emit('styledata')).not.toThrow();
  });

  it('also retries on the load event', () => {
    const { map, emit } = createFakeMap();
    let ready = false;
    const setup = vi.fn(() => {
      if (!ready) throw styleNotLoadedError();
    });

    runWhenStyleReady(map, setup);
    ready = true;
    emit('load');

    expect(setup).toHaveBeenCalledTimes(2);
  });

  it('re-runs setup after a later style swap (styledata), so custom layers can be restored', () => {
    const { map, emit } = createFakeMap();
    const setup = vi.fn();

    runWhenStyleReady(map, setup);
    emit('styledata');
    emit('styledata');

    expect(setup).toHaveBeenCalledTimes(3);
  });

  it('propagates any error that is NOT MapLibre\'s "not done loading" rejection', () => {
    const { map } = createFakeMap();
    const setup = vi.fn(() => {
      throw new Error('bad layer spec');
    });

    expect(() => runWhenStyleReady(map, setup)).toThrow('bad layer spec');
  });

  it('unsubscribes both listeners on cleanup', () => {
    const { map, emit, listenerCount } = createFakeMap();
    const setup = vi.fn();

    const cleanup = runWhenStyleReady(map, setup);
    expect(listenerCount('styledata')).toBe(1);
    expect(listenerCount('load')).toBe(1);

    cleanup();
    expect(listenerCount('styledata')).toBe(0);
    expect(listenerCount('load')).toBe(0);

    emit('styledata');
    expect(setup).toHaveBeenCalledTimes(1); // only the initial attempt
  });
});
