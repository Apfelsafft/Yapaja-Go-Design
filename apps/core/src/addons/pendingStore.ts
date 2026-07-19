/**
 * In-memory store for PENDING installs (E09-T1 §2 step 5, docs/05
 * "Sicherheitsregeln: Scopes werden bei Installation angezeigt und
 * bestätigt"): `POST /addons/install` validates a tarball and stashes the
 * result here WITHOUT unpacking to `data/addons/{id}` or touching the DB;
 * only a matching `POST /addons/install/:pendingId/confirm` call actually
 * installs it (`installService.ts`).
 *
 * Deliberately in-memory (not persisted): a pending install is a short-lived
 * confirmation handshake within a single operator session, not durable
 * state -- a Core restart between "install" and "confirm" simply expires
 * the pending token (the operator re-submits), which is the same failure
 * mode as the token just expiring on its own (see `PENDING_TTL_MS`).
 */

import { randomUUID } from 'crypto';
import { Buffer } from 'node:buffer';
import type { AddonManifest } from '@yapaja/shared';

/** How long an unconfirmed pending install stays valid. */
export const PENDING_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface PendingInstall {
  pendingId: string;
  manifest: AddonManifest;
  /** Raw validated tarball bytes, re-extracted (for real, to disk this
   *  time) by `confirmInstall`. */
  tarballBytes: Buffer;
  /** `true` when this pending install targets an id that's already
   *  installed (i.e. this is an UPDATE, not a fresh install) -- surfaced to
   *  the client in the install response and used by `confirmInstall` to
   *  pick the update-with-rollback path. */
  isUpdate: boolean;
  /** Scope-confirmation warnings (E09-T1 §2: dangerous permission
   *  combinations, e.g. `nav.control` + any `net.fetch:*`). Purely
   *  informational -- install is never blocked on a warning, only shown. */
  warnings: string[];
  createdAt: number;
  expiresAt: number;
}

export class PendingInstallStore {
  private readonly pending = new Map<string, PendingInstall>();

  constructor(private readonly ttlMs: number = PENDING_TTL_MS) {}

  create(params: {
    manifest: AddonManifest;
    tarballBytes: Buffer;
    isUpdate: boolean;
    warnings: string[];
  }): PendingInstall {
    const now = Date.now();
    const entry: PendingInstall = {
      pendingId: randomUUID(),
      manifest: params.manifest,
      tarballBytes: params.tarballBytes,
      isUpdate: params.isUpdate,
      warnings: params.warnings,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.pending.set(entry.pendingId, entry);
    return entry;
  }

  /** Returns the pending install if it exists and hasn't expired; expired
   *  entries are lazily evicted here rather than via a timer. */
  get(pendingId: string): PendingInstall | null {
    const entry = this.pending.get(pendingId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.pending.delete(pendingId);
      return null;
    }
    return entry;
  }

  /** Consumes (removes) a pending install -- called once confirm succeeds
   *  OR definitively fails, so a pending token is always single-use. */
  consume(pendingId: string): void {
    this.pending.delete(pendingId);
  }
}
