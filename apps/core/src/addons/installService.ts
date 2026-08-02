/**
 * Orchestrates the add-on install/update/lifecycle pipeline (E09-T1, docs/05
 * §2/§5). This is the ONE place that ties together: sha256 verification,
 * the 50 MB size caps, manifest validation (`@yapaja/shared`), the
 * `core_api` semver-range check (Wargame W-11), the two-step scope-confirm
 * gate (`pendingStore.ts`), the hardened extractor (`extract.ts`), the
 * update-with-rollback swap, and the DB row (`repository.ts`).
 *
 * Two-step scope-confirm flow (docs/05 §2 "Scopes werden bei Installation
 * angezeigt und bestätigt"):
 *   1. `beginInstallFromUpload`/`beginInstallFromUrl` -- downloads/accepts
 *      the tarball, verifies sha256 + size, runs a DRY-RUN extraction
 *      (`extract.ts` with `destDir: null` -- every security check still
 *      runs, nothing is written to disk), validates the manifest, checks
 *      `core_api`, and stashes the result as a `PendingInstall`. Nothing is
 *      installed yet -- the DB has no row, `data/addons/` is untouched.
 *   2. `confirmInstall` -- looks the pending install up, RE-RUNS the full
 *      hardened extraction (this time for real, into a throwaway staging
 *      directory) as defense in depth (never trust step 1's result alone),
 *      runs a "does this version look startable" check, and only THEN
 *      either creates a fresh `data/addons/{id}` (new install) or swaps a
 *      validated new version in for an existing one (update -- see the
 *      rollback section below). The DB row is written in the SAME step.
 *
 * Update rollback (docs/05 §5 "ein-Klick-Update mit Rollback"): the new
 * version is extracted into a PARALLEL staging directory and validated
 * FIRST; the pre-existing `data/addons/{id}` is never touched until that
 * validation succeeds. If extraction OR the post-extraction "start" check
 * fails, the staging directory is discarded and the old directory is
 * untouched -- rollback is really just "never commit". The one path that
 * DOES briefly touch the old directory is the final rename swap itself
 * (old -> old`.rollback-*`, staging -> old); if THAT rename fails (e.g. a
 * disk error), the old directory is renamed back into place before the
 * error propagates.
 */

import { randomUUID, createHash } from 'crypto';
import { mkdir, rename, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { Buffer } from 'node:buffer';
import type { AddonManifest } from '@yapaja/shared';
import { validateAddonManifest, getValidationErrorsAddonManifest, satisfies } from '@yapaja/shared';
import { extractAddonTarball } from './extract.js';
import { AddonError } from './errors.js';
import {
  resolveAddonsRootDir,
  resolveAddonStorageRootDir,
  resolveAddonStagingRootDir,
  resolveAddonDir,
  resolveEntryPath,
} from './paths.js';
import { AddonRepository, type AddonRecord } from './repository.js';
import { PendingInstallStore, type PendingInstall } from './pendingStore.js';

/** Compressed upload/download size cap (E09-T1 §2 step 2). */
export const MAX_TARBALL_COMPRESSED_BYTES = 50 * 1024 * 1024;
/** Cumulative UNCOMPRESSED size cap enforced during streaming extraction
 *  (zip-bomb guard, same 50 MB budget). */
export const MAX_TARBALL_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

export interface BeginInstallResult {
  pendingId: string;
  manifest: AddonManifest;
  permissions: string[];
  warnings: string[];
  isUpdate: boolean;
  sha256: string;
  expiresAt: string;
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizeSha256(value: string): string {
  return value.trim().toLowerCase();
}

/** Flags dangerous permission COMBINATIONS (docs/05 §2: "Gefährliche
 *  Kombinationen (z. B. nav.control + net.fetch) bekommen einen roten
 *  Hinweis"). Purely advisory -- returned to the client for the two-step
 *  confirm UI, never blocks install by itself. */
export function computeScopeWarnings(permissions: readonly string[]): string[] {
  const warnings: string[] = [];
  const hasNavControl = permissions.includes('nav.control');
  const hasNetFetch = permissions.some((p) => p.startsWith('net.fetch:'));
  if (hasNavControl && hasNetFetch) {
    warnings.push(
      'This add-on requests both nav.control (can start/stop navigation and set destinations) ' +
        'and net.fetch (outbound network access) -- it could steer the vehicle based on data ' +
        'from the internet without an obvious local cause. Review carefully before confirming.',
    );
  }
  return warnings;
}

/**
 * E09-T3: the seam through which the add-on SERVICE RUNTIME
 * (`service-host.ts`) is tied to the `enabled` flag. `InstallService` is the
 * single entry point for enable/disable/uninstall, so hanging the process
 * lifecycle here guarantees there is no path that flips `enabled` without the
 * matching spawn/kill + token issue/revoke. Structural: the install pipeline
 * knows nothing about child processes.
 */
export interface AddonLifecycleListener {
  onEnabled(record: AddonRecord): void;
  onDisabled(addonId: string): void;
  onUninstalled(addonId: string): void;
}

export interface InstallServiceOptions {
  repository?: AddonRepository;
  pendingStore?: PendingInstallStore;
  /** The running Core's version, checked against each manifest's
   *  `core_api` semver range (Wargame W-11). Reuses the SAME
   *  `readPackageVersion()` result `/api/v1/health` reports -- see
   *  `index.ts`. */
  coreVersion: string;
  addonsRootDir?: string;
  /** Root dir for add-on OWN storage (`storage.own`); defaults to
   *  `resolveAddonStorageRootDir()`. Separate from `addonsRootDir` by
   *  design (see `paths.ts`) -- injectable here too so tests never touch a
   *  real `data/addon-storage/` relative to the process cwd. */
  addonsStorageRootDir?: string;
  maxCompressedBytes?: number;
  maxUncompressedBytes?: number;
  /** E09-T3 service runtime; omit to run without any add-on processes. */
  lifecycle?: AddonLifecycleListener;
}

export class InstallService {
  private readonly repository: AddonRepository;
  private readonly pendingStore: PendingInstallStore;
  private readonly coreVersion: string;
  private readonly addonsRootDir: string;
  private readonly addonsStorageRootDir: string;
  private readonly maxCompressedBytes: number;
  private readonly maxUncompressedBytes: number;
  private readonly lifecycle?: AddonLifecycleListener;

  constructor(opts: InstallServiceOptions) {
    this.repository = opts.repository ?? new AddonRepository();
    this.pendingStore = opts.pendingStore ?? new PendingInstallStore();
    this.coreVersion = opts.coreVersion;
    this.addonsRootDir = opts.addonsRootDir ?? resolveAddonsRootDir();
    this.addonsStorageRootDir = opts.addonsStorageRootDir ?? resolveAddonStorageRootDir();
    this.maxCompressedBytes = opts.maxCompressedBytes ?? MAX_TARBALL_COMPRESSED_BYTES;
    this.maxUncompressedBytes = opts.maxUncompressedBytes ?? MAX_TARBALL_UNCOMPRESSED_BYTES;
    this.lifecycle = opts.lifecycle;
  }

  /** A lifecycle listener must never be able to break the lifecycle itself:
   *  a throwing service host is logged-and-swallowed, the DB row stays
   *  authoritative. */
  private notify(fn: (listener: AddonLifecycleListener) => void): void {
    if (!this.lifecycle) return;
    try {
      fn(this.lifecycle);
    } catch {
      /* the `enabled` flag is the source of truth; a host failure never
         rolls back the operator's decision */
    }
  }

  listAddons(): AddonRecord[] {
    return this.repository.listAll();
  }

  /**
   * Step 1 (upload path): a digest is OPTIONAL for a direct upload, but if
   * the caller supplies one it MUST match (documented in E09-T1's task
   * spec) -- an operator who bothers to pass a digest clearly wants it
   * checked, so a mismatch is still a hard reject, not a soft warning.
   */
  async beginInstallFromUpload(tarballBytes: Buffer, expectedSha256?: string): Promise<BeginInstallResult> {
    return this.beginInstall(tarballBytes, expectedSha256, false);
  }

  /** Step 1 (URL/registry path): a digest is MANDATORY (E09-T1 §2 step 1). */
  async beginInstallFromUrl(tarballBytes: Buffer, expectedSha256: string): Promise<BeginInstallResult> {
    return this.beginInstall(tarballBytes, expectedSha256, true);
  }

  private async beginInstall(
    tarballBytes: Buffer,
    expectedSha256: string | undefined,
    sha256Required: boolean,
  ): Promise<BeginInstallResult> {
    if (tarballBytes.length > this.maxCompressedBytes) {
      throw new AddonError(
        'TARBALL_TOO_LARGE',
        `Add-on tarball is ${tarballBytes.length} bytes, exceeding the ${this.maxCompressedBytes}-byte compressed-size cap`,
      );
    }

    const actualSha256 = sha256Hex(tarballBytes);
    if (sha256Required && !expectedSha256) {
      throw new AddonError('SHA256_REQUIRED', 'A sha256 digest is required for a URL/registry install');
    }
    if (expectedSha256 && normalizeSha256(expectedSha256) !== actualSha256) {
      throw new AddonError(
        'SHA256_MISMATCH',
        `sha256 mismatch: expected ${normalizeSha256(expectedSha256)}, got ${actualSha256}`,
      );
    }

    // Dry-run extraction: every security check in extract.ts runs (path
    // traversal / absolute path / symlink+hardlink / disallowed entry type /
    // uncompressed zip-bomb cap), but destDir is null so NOTHING is written
    // to disk yet -- a malicious tarball is rejected right here, at step 1.
    const { manifestRaw } = await extractAddonTarball({
      tarballBytes,
      destDir: null,
      maxUncompressedBytes: this.maxUncompressedBytes,
    });

    let manifestJson: unknown;
    try {
      manifestJson = JSON.parse(manifestRaw);
    } catch {
      throw new AddonError('INVALID_MANIFEST', 'yapaja-addon.json is not valid JSON');
    }

    if (!validateAddonManifest(manifestJson)) {
      const errors = getValidationErrorsAddonManifest(manifestJson);
      throw new AddonError('INVALID_MANIFEST', `yapaja-addon.json is invalid: ${errors.join('; ')}`);
    }
    const manifest = manifestJson;

    // Defense in depth: the schema already enforces ADDON_ID_PATTERN, but
    // never trust that alone for something that becomes a directory name --
    // re-derive the real install path the same way confirmInstall will.
    if (!resolveAddonDir(this.addonsRootDir, manifest.id)) {
      throw new AddonError('INVALID_MANIFEST', `Manifest id "${manifest.id}" is not a safe directory name`);
    }

    // Wargame W-11: an add-on whose declared core_api range doesn't cover
    // this Core's version is rejected outright, with a clear message.
    if (!satisfies(this.coreVersion, manifest.core_api)) {
      throw new AddonError(
        'INCOMPATIBLE_CORE_API',
        `Add-on "${manifest.id}" requires core_api ${manifest.core_api}, this Core is ${this.coreVersion}`,
      );
    }

    const existing = this.repository.getById(manifest.id);
    const warnings = computeScopeWarnings(manifest.permissions);

    const pending = this.pendingStore.create({
      manifest,
      tarballBytes,
      isUpdate: existing !== null,
      warnings,
    });

    return {
      pendingId: pending.pendingId,
      manifest,
      permissions: manifest.permissions,
      warnings,
      isUpdate: pending.isUpdate,
      sha256: actualSha256,
      expiresAt: new Date(pending.expiresAt).toISOString(),
    };
  }

  /**
   * Step 2: actually unpack + enable. See the module doc for the full
   * update-with-rollback sequencing. Always consumes (single-use) the
   * pending token, success or failure.
   */
  async confirmInstall(pendingId: string): Promise<AddonRecord> {
    const pending = this.pendingStore.get(pendingId);
    if (!pending) {
      throw new AddonError('PENDING_NOT_FOUND', 'Pending install not found or expired -- start over');
    }

    try {
      return await this.performConfirm(pending);
    } finally {
      // Single-use regardless of outcome: a failed confirm must not be
      // silently retryable against a now-possibly-inconsistent pending
      // record -- the operator re-submits step 1.
      this.pendingStore.consume(pendingId);
    }
  }

  private async performConfirm(pending: PendingInstall): Promise<AddonRecord> {
    const { manifest } = pending;
    const finalDir = resolveAddonDir(this.addonsRootDir, manifest.id);
    if (!finalDir) {
      throw new AddonError('INVALID_MANIFEST', `Manifest id "${manifest.id}" is not a safe directory name`);
    }

    const stagingRoot = resolveAddonStagingRootDir(this.addonsRootDir);
    await mkdir(stagingRoot, { recursive: true });
    const tempDir = join(stagingRoot, `${manifest.id}-${randomUUID()}`);

    // Re-run the FULL hardened extraction for real (defense in depth: never
    // trust the step-1 dry run alone). Writes into the throwaway tempDir,
    // never `finalDir` directly.
    await extractAddonTarball({
      tarballBytes: pending.tarballBytes,
      destDir: tempDir,
      maxUncompressedBytes: this.maxUncompressedBytes,
    });

    // "Does this version look startable" check -- this task doesn't launch
    // add-on processes yet (E09-T2/T3), so this is a proxy for it: the
    // manifest's declared entry points must actually exist in the package.
    // A failure here is the ROLLBACK trigger for an update: tempDir is
    // discarded and finalDir (if it already existed) is never touched.
    const startError = this.findStartValidationError(tempDir, manifest);
    if (startError) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      throw new AddonError('ADDON_START_FAILED', startError);
    }

    const existing = this.repository.getById(manifest.id);

    if (existing) {
      await this.swapUpdatedVersion(finalDir, tempDir);
      return this.repository.updateVersion({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        manifest,
      });
    }

    await mkdir(dirname(finalDir), { recursive: true });
    await rename(tempDir, finalDir);
    // New installs land DISABLED -- an explicit `POST /addons/:id/enable`
    // is required before anything would ever run (E09-T1's plausibility
    // check: `enabled` is the one source of truth a later task's add-on
    // runtime must consult). Scopes were already confirmed by the operator
    // reaching this step, but "installed" and "active" are kept distinct.
    return this.repository.insert({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      manifest,
      enabled: false,
      installPath: finalDir,
    });
  }

  /** Two-phase-commit rename: back up the live directory, swap the staged
   *  one in, and restore the backup if the second rename itself fails. */
  private async swapUpdatedVersion(finalDir: string, tempDir: string): Promise<void> {
    if (!existsSync(finalDir)) {
      // Nothing to roll back to (e.g. the DB row exists but the directory
      // was already removed out-of-band) -- just move the new one in.
      await rename(tempDir, finalDir);
      return;
    }
    const backupDir = `${finalDir}.rollback-${randomUUID()}`;
    await rename(finalDir, backupDir);
    try {
      await rename(tempDir, finalDir);
    } catch (err) {
      // Rollback: put the old version back exactly where it was.
      await rename(backupDir, finalDir).catch(() => {});
      throw new AddonError(
        'UPDATE_SWAP_FAILED',
        `Failed to activate the new version, rolled back to the previous one: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    await rm(backupDir, { recursive: true, force: true }).catch(() => {});
  }

  /** Returns a human-readable error string if a declared entry point is
   *  missing from the extracted package, or `null` if everything declared
   *  is present. */
  private findStartValidationError(tempDir: string, manifest: AddonManifest): string | null {
    const declaredEntries: Array<{ label: string; entry: string }> = [];
    if (manifest.service) declaredEntries.push({ label: 'service.entry', entry: manifest.service.entry });
    if (manifest.ui) declaredEntries.push({ label: 'ui.entry', entry: manifest.ui.entry });

    for (const { label, entry } of declaredEntries) {
      const resolved = resolveEntryPath(tempDir, entry);
      if (!resolved || !existsSync(resolved)) {
        return `Manifest declares ${label} = "${entry}", but that file is not present in the package`;
      }
    }
    return null;
  }

  enable(id: string): AddonRecord {
    const record = this.repository.setEnabled(id, true);
    if (!record) throw new AddonError('NOT_FOUND', `No add-on installed with id "${id}"`);
    // E09-T3: issue the scoped token + spawn the service process (if any).
    this.notify((l) => l.onEnabled(record));
    return record;
  }

  disable(id: string): AddonRecord {
    const record = this.repository.setEnabled(id, false);
    if (!record) throw new AddonError('NOT_FOUND', `No add-on installed with id "${id}"`);
    // E09-T3: kill the process AND revoke the token -- immediately.
    this.notify((l) => l.onDisabled(id));
    return record;
  }

  /** Removes code + storage + the DB row completely -- a test asserts
   *  nothing survives on either the filesystem or in the DB. */
  async uninstall(id: string): Promise<void> {
    const record = this.repository.getById(id);
    if (!record) throw new AddonError('NOT_FOUND', `No add-on installed with id "${id}"`);

    // E09-T3: stop the process + revoke the token BEFORE anything is deleted,
    // so a running service can never observe a half-removed installation.
    this.notify((l) => l.onUninstalled(id));

    const codeDir = resolveAddonDir(this.addonsRootDir, id);
    if (codeDir) {
      await rm(codeDir, { recursive: true, force: true });
    }
    const storageDir = resolveAddonDir(this.addonsStorageRootDir, id);
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true });
    }
    this.repository.delete(id);
  }
}

// Re-exported so routes.ts doesn't need to reach into paths.ts/errors.ts
// separately for these.
export { resolveAddonsRootDir, resolveAddonStorageRootDir } from './paths.js';
export { TarballSecurityError } from './errors.js';
