/**
 * W-20 (docs/08 Wargame): "Browser-Storage wird evakuiert (Eviction bei
 * Speicherdruck)". `localStorage`/`CacheStorage`/IndexedDB are only a CACHE
 * -- the source of truth for layouts/settings/favorites is SQLite in the
 * Core -- but requesting `navigator.storage.persist()` still reduces how
 * eagerly the browser evicts this origin's storage under disk pressure
 * (relevant on a kiosk mini-PC that also holds gigabytes of offline PMTiles
 * data), so it's still worth asking for on every startup.
 *
 * Best-effort by design: browsers may silently refuse (e.g. engagement
 * heuristics not met, or the API simply isn't implemented) -- callers must
 * never treat a `false`/rejection as an error, and this must never block or
 * throw during app boot.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return false;
  }
  try {
    return await navigator.storage.persist();
  } catch (err) {
    console.warn('[pwa] navigator.storage.persist() failed:', err);
    return false;
  }
}
