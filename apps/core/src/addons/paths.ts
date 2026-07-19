/**
 * Add-on directory resolution + path-traversal defenses (E09-T1, docs/05
 * §2/§5). Mirrors `apps/core/src/map/paths.ts`'s "validate name, then
 * resolve+prefix-check" pattern -- same defense-in-depth idea: the add-on
 * `id` is already validated by the shared manifest schema
 * (`ADDON_ID_PATTERN`, `@yapaja/shared`) before it ever reaches here, but
 * every function in this file re-validates and re-checks the resolved path
 * itself, never trusting a single upstream check alone.
 */

import { join, resolve, sep } from 'path';
import { ADDON_ID_PATTERN } from '@yapaja/shared';

/** Same pattern the manifest schema enforces on `id` -- compiled once here
 *  for the Core's own defense-in-depth re-check. */
export const ADDON_ID_RE = new RegExp(ADDON_ID_PATTERN);

/** Root directory all installed add-ons live under. `ADDONS_DIR` mirrors
 *  `DB_PATH`/`TILES_DIR`'s env-override convention. */
export function resolveAddonsRootDir(): string {
  return process.env.ADDONS_DIR || 'data/addons';
}

/** Root directory add-on OWN storage (`storage.own` scope) lives under --
 *  deliberately separate from the code directory so `data/addons/{id}` can
 *  be atomically swapped during an update (E09-T1 §5 rollback) without
 *  touching the add-on's persisted key/value data, while uninstall still
 *  wipes both (see `installService.ts#uninstall`). */
export function resolveAddonStorageRootDir(): string {
  return process.env.ADDON_STORAGE_DIR || 'data/addon-storage';
}

/** Staging root for in-progress installs/updates -- extraction always
 *  happens into a throwaway subdirectory here FIRST; only a fully validated
 *  result ever gets renamed into the real add-on directory. Takes the
 *  add-ons ROOT dir explicitly (rather than re-resolving `ADDONS_DIR`
 *  itself) so it always stays under whatever root the caller (typically
 *  `InstallService`, which may have an injected/test root) is actually
 *  using -- never a second, independently-resolved default. */
export function resolveAddonStagingRootDir(addonsRootDir: string): string {
  return join(addonsRootDir, '.staging');
}

/**
 * Resolves `id` to an absolute directory inside `rootDir`, or returns
 * `null` if `id` fails the strict allow-list pattern OR (defense in depth)
 * the resolved path would not stay strictly inside `rootDir`. This is the
 * ONE function every add-on filesystem operation (install, enable/disable
 * lookups, uninstall, update) must route through for the code directory;
 * `resolveAddonStorageDir` is its `storage.own` counterpart.
 */
export function resolveAddonDir(rootDir: string, id: string): string | null {
  if (!ADDON_ID_RE.test(id)) return null;
  const resolvedRoot = resolve(rootDir);
  const resolvedDir = resolve(join(resolvedRoot, id));
  if (resolvedDir !== resolvedRoot && !resolvedDir.startsWith(resolvedRoot + sep)) {
    return null;
  }
  return resolvedDir;
}

export function resolveAddonStorageDir(id: string): string | null {
  return resolveAddonDir(resolveAddonStorageRootDir(), id);
}

/**
 * Resolves a tar-entry-relative path (already required to be a plain
 * relative POSIX path, see `extract.ts`) against `destDir`, rejecting any
 * entry whose resolved path escapes `destDir` -- the actual `../`/absolute-
 * path traversal guard used during extraction. `destDir` itself is always
 * an already-validated `resolveAddonDir`/staging result, never raw user
 * input.
 */
export function resolveEntryPath(destDir: string, entryName: string): string | null {
  const resolvedDest = resolve(destDir);
  const resolvedEntry = resolve(join(resolvedDest, entryName));
  if (resolvedEntry !== resolvedDest && !resolvedEntry.startsWith(resolvedDest + sep)) {
    return null;
  }
  return resolvedEntry;
}
