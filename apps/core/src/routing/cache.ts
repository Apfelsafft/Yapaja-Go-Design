/**
 * In-memory route cache backing `GET /routes/:id`.
 *
 * Contract (task E03-T2): TTL 1 h, max 20 entries, evict least-recently-used
 * when full. Backed by a `Map`, which preserves insertion order -- we move an
 * entry to the end on every `get`/`set`, so the first key is always the LRU
 * one. `now` is injectable for deterministic TTL tests.
 */

import type { Route } from '@yapaja/shared';

export const DEFAULT_ROUTE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
export const DEFAULT_ROUTE_CACHE_MAX = 20;

interface CacheEntry {
  route: Route;
  expiresAt: number;
}

export interface RouteCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export class RouteCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(opts: RouteCacheOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_ROUTE_CACHE_TTL_MS;
    this.maxEntries = opts.maxEntries ?? DEFAULT_ROUTE_CACHE_MAX;
    this.now = opts.now ?? Date.now;
  }

  set(route: Route): void {
    // Refresh position if already present, then (re)insert at the end.
    this.entries.delete(route.id);
    this.entries.set(route.id, { route, expiresAt: this.now() + this.ttlMs });

    // Evict least-recently-used entries until within budget.
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get(id: string): Route | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(id);
      return null;
    }
    // Mark as most-recently-used.
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry.route;
  }

  get size(): number {
    return this.entries.size;
  }
}
