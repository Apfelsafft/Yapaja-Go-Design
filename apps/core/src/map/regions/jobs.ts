/**
 * Minimal in-memory job registry (E01-T5).
 *
 * Deliberately small: no persistence across restarts, no queueing/
 * concurrency limits, no job kinds/types beyond a status+progress+bytes
 * envelope. Region downloads are the only producer today; the shape is
 * generic enough that a future job (e.g. Valhalla graph rebuild, W-17)
 * could reuse it without changes, but we don't build that out here.
 *
 * `GET /api/v1/jobs/:id` (docs/03-api-spec.md §2) reads a JobSnapshot;
 * `DELETE /api/v1/jobs/:id` requests cancellation of a queued/running job.
 */

import { randomUUID } from 'crypto';

export type JobStatus = 'queued' | 'running' | 'done' | 'error';

export interface JobErrorInfo {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface JobSnapshot {
  id: string;
  status: JobStatus;
  /** 0..1. Always 1 once status is 'done'. */
  progress: number;
  /** Bytes transferred so far (for download jobs). */
  bytes: number;
  /** Expected total bytes, if known. */
  totalBytes: number | null;
  error: JobErrorInfo | null;
  createdAt: string;
  updatedAt: string;
}

interface JobRecord extends JobSnapshot {
  cancelled: boolean;
  onCancel: (() => void) | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toSnapshot(record: JobRecord): JobSnapshot {
  return {
    id: record.id,
    status: record.status,
    progress: record.progress,
    bytes: record.bytes,
    totalBytes: record.totalBytes,
    error: record.error,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function isFinished(record: JobRecord): boolean {
  return record.status === 'done' || record.status === 'error';
}

export class JobRegistry {
  private readonly jobs = new Map<string, JobRecord>();

  /** Registers a new job in `queued` state and returns its id. */
  create(): string {
    const id = randomUUID();
    const timestamp = nowIso();
    this.jobs.set(id, {
      id,
      status: 'queued',
      progress: 0,
      bytes: 0,
      totalBytes: null,
      error: null,
      cancelled: false,
      onCancel: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return id;
  }

  get(id: string): JobSnapshot | undefined {
    const record = this.jobs.get(id);
    return record ? toSnapshot(record) : undefined;
  }

  /** Registers a callback invoked once if/when the job is cancelled (used
   *  by the download runner to abort its in-flight HTTP request). */
  setOnCancel(id: string, onCancel: (() => void) | null): void {
    const record = this.jobs.get(id);
    if (record) {
      record.onCancel = onCancel;
    }
  }

  isCancelled(id: string): boolean {
    return this.jobs.get(id)?.cancelled ?? false;
  }

  markRunning(id: string, totalBytes: number | null = null): void {
    const record = this.jobs.get(id);
    if (!record || isFinished(record)) {
      return;
    }
    record.status = 'running';
    if (totalBytes !== null) {
      record.totalBytes = totalBytes;
    }
    record.updatedAt = nowIso();
  }

  updateProgress(id: string, bytes: number, totalBytes?: number | null): void {
    const record = this.jobs.get(id);
    if (!record || isFinished(record)) {
      return;
    }
    record.bytes = bytes;
    if (totalBytes !== undefined && totalBytes !== null) {
      record.totalBytes = totalBytes;
    }
    record.progress = record.totalBytes ? Math.min(1, bytes / record.totalBytes) : 0;
    record.updatedAt = nowIso();
  }

  markDone(id: string): void {
    const record = this.jobs.get(id);
    if (!record) {
      return;
    }
    record.status = 'done';
    record.progress = 1;
    record.error = null;
    record.updatedAt = nowIso();
  }

  markError(id: string, error: JobErrorInfo): void {
    const record = this.jobs.get(id);
    if (!record) {
      return;
    }
    record.status = 'error';
    record.error = error;
    record.updatedAt = nowIso();
  }

  /**
   * Requests cancellation of a queued/running job (fires its onCancel
   * callback, if any, so an in-flight download aborts promptly). Returns
   * false if the job doesn't exist or has already finished.
   */
  cancel(id: string): boolean {
    const record = this.jobs.get(id);
    if (!record || isFinished(record)) {
      return false;
    }
    record.cancelled = true;
    record.onCancel?.();
    return true;
  }
}
