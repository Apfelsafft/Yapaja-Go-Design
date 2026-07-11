/**
 * Route cache tests: TTL expiry, max-size LRU eviction, recency refresh.
 */

import { describe, it, expect } from 'vitest';
import type { Route } from '@yapaja/shared';
import { RouteCache } from './cache.js';

function route(id: string): Route {
  return {
    id,
    distance_m: 1000,
    duration_s: 100,
    geometry: '',
    legs: [],
    maneuvers: [],
    speed_limits: [],
    warnings: [],
  };
}

describe('RouteCache', () => {
  it('stores and returns a route by id', () => {
    const cache = new RouteCache();
    cache.set(route('a'));
    expect(cache.get('a')?.id).toBe('a');
  });

  it('returns null for a missing id', () => {
    expect(new RouteCache().get('nope')).toBeNull();
  });

  it('expires entries after the TTL', () => {
    let now = 1000;
    const cache = new RouteCache({ ttlMs: 500, now: () => now });
    cache.set(route('a'));
    now = 1499;
    expect(cache.get('a')?.id).toBe('a');
    now = 1501;
    expect(cache.get('a')).toBeNull();
  });

  it('evicts the least-recently-used entry beyond max size', () => {
    const cache = new RouteCache({ maxEntries: 2 });
    cache.set(route('a'));
    cache.set(route('b'));
    // Touch 'a' so 'b' becomes the LRU.
    expect(cache.get('a')?.id).toBe('a');
    cache.set(route('c'));
    expect(cache.get('b')).toBeNull(); // evicted
    expect(cache.get('a')?.id).toBe('a');
    expect(cache.get('c')?.id).toBe('c');
    expect(cache.size).toBe(2);
  });
});
