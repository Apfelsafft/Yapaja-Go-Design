/**
 * Restart-recovery store (E04-T1, W-19).
 *
 * On a core restart the navigation state must NOT come back as `navigating`
 * (no "ghost navigation"): `NavigationService` is in-memory, so it always
 * boots `idle`. Separately, the LAST active navigation's route reference is
 * persisted here so that — if that route is still available in the routing
 * cache — the service can publish `event/nav_recovered_route_available` and let
 * the UI offer a one-click resume.
 *
 * The store persists only a route reference + destination, never the
 * `navigating` status itself. The interface is injectable: tests use the
 * in-memory implementation; production wires the file-backed one.
 */

import type { LatLng } from '@yapaja/shared';

export interface NavRecoveryRecord {
  route_id: string;
  destination: { latlng: LatLng; name: string | null } | null;
}

export interface NavRecoveryStore {
  load(): NavRecoveryRecord | null;
  save(record: NavRecoveryRecord): void;
  clear(): void;
}

/** In-memory store; nothing survives the process (used by tests). */
export class InMemoryNavRecoveryStore implements NavRecoveryStore {
  private record: NavRecoveryRecord | null;

  constructor(initial: NavRecoveryRecord | null = null) {
    this.record = initial;
  }

  load(): NavRecoveryRecord | null {
    return this.record;
  }

  save(record: NavRecoveryRecord): void {
    this.record = record;
  }

  clear(): void {
    this.record = null;
  }
}

export interface FileNavRecoveryStoreLogger {
  warn: (msg: string, meta?: Record<string, unknown>) => void;
}

/** The narrow slice of `node:fs` the store needs (kept injectable for tests). */
export interface FsLike {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: 'utf-8') => string;
  writeFileSync: (path: string, data: string, encoding: 'utf-8') => void;
  mkdirSync: (path: string, opts: { recursive: boolean }) => string | undefined;
  rmSync: (path: string) => void;
}

/**
 * File-backed store: a single small JSON file. Every operation is best-effort
 * and NEVER throws — a failed read/write must not crash the core nor block
 * navigation. Failures are logged (no silent failures) and treated as "no
 * recovery record".
 */
export class FileNavRecoveryStore implements NavRecoveryStore {
  private readonly path: string;
  private readonly logger: FileNavRecoveryStoreLogger;
  private readonly fs: FsLike;
  private readonly dirname: (p: string) => string;

  constructor(
    path: string,
    deps: {
      fs: FsLike;
      dirname: (p: string) => string;
      logger?: FileNavRecoveryStoreLogger;
    },
  ) {
    this.path = path;
    this.fs = deps.fs;
    this.dirname = deps.dirname;
    this.logger = deps.logger ?? { warn: () => {} };
  }

  load(): NavRecoveryRecord | null {
    try {
      if (!this.fs.existsSync(this.path)) return null;
      const raw = this.fs.readFileSync(this.path, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as NavRecoveryRecord).route_id === 'string'
      ) {
        return parsed as NavRecoveryRecord;
      }
      return null;
    } catch (err) {
      this.logger.warn('FileNavRecoveryStore: failed to read recovery record', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  save(record: NavRecoveryRecord): void {
    try {
      this.fs.mkdirSync(this.dirname(this.path), { recursive: true });
      this.fs.writeFileSync(this.path, JSON.stringify(record), 'utf-8');
    } catch (err) {
      this.logger.warn('FileNavRecoveryStore: failed to write recovery record', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  clear(): void {
    try {
      if (this.fs.existsSync(this.path)) this.fs.rmSync(this.path);
    } catch (err) {
      this.logger.warn('FileNavRecoveryStore: failed to clear recovery record', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
