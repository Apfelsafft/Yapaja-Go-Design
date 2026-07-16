/**
 * Default on-disk location for the lite search index (E05-T5, W-12).
 * Mirrors `apps/core/src/map/paths.ts`'s `resolveTilesDir()` shape: an
 * env-var override for containers/CI, a sane relative default for local
 * dev. `data/` is gitignored (see `services/valhalla/README.md`'s
 * equivalent layout note) -- `lite_search.db` is a build artifact, never
 * committed.
 */
export function resolveLiteSearchDbPath(): string {
  return process.env.LITE_SEARCH_DB_PATH || 'data/lite-search/lite_search.db';
}
