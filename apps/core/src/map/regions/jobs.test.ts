import { describe, it, expect } from 'vitest';
import { JobRegistry } from './jobs.js';

describe('JobRegistry', () => {
  it('creates a job in queued state with progress 0', () => {
    const registry = new JobRegistry();
    const id = registry.create();
    const job = registry.get(id);
    expect(job).toBeDefined();
    expect(job?.status).toBe('queued');
    expect(job?.progress).toBe(0);
    expect(job?.bytes).toBe(0);
    expect(job?.totalBytes).toBeNull();
    expect(job?.error).toBeNull();
  });

  it('returns undefined for an unknown job id', () => {
    const registry = new JobRegistry();
    expect(registry.get('does-not-exist')).toBeUndefined();
  });

  it('tracks running -> progress updates -> done', () => {
    const registry = new JobRegistry();
    const id = registry.create();

    registry.markRunning(id, 1000);
    expect(registry.get(id)?.status).toBe('running');
    expect(registry.get(id)?.totalBytes).toBe(1000);

    registry.updateProgress(id, 250);
    expect(registry.get(id)?.progress).toBeCloseTo(0.25);
    expect(registry.get(id)?.bytes).toBe(250);

    registry.updateProgress(id, 1000);
    expect(registry.get(id)?.progress).toBeCloseTo(1);

    registry.markDone(id);
    const done = registry.get(id);
    expect(done?.status).toBe('done');
    expect(done?.progress).toBe(1);
    expect(done?.error).toBeNull();
  });

  it('caps progress at 1 even if bytes exceed totalBytes', () => {
    const registry = new JobRegistry();
    const id = registry.create();
    registry.markRunning(id, 100);
    registry.updateProgress(id, 150);
    expect(registry.get(id)?.progress).toBe(1);
  });

  it('records an error and stops accepting further progress updates', () => {
    const registry = new JobRegistry();
    const id = registry.create();
    registry.markRunning(id, 100);
    registry.updateProgress(id, 50);
    registry.markError(id, { code: 'DOWNLOAD_FAILED', message: 'boom' });

    const job = registry.get(id);
    expect(job?.status).toBe('error');
    expect(job?.error).toEqual({ code: 'DOWNLOAD_FAILED', message: 'boom' });

    // Progress updates after a terminal state are ignored.
    registry.updateProgress(id, 90);
    expect(registry.get(id)?.bytes).toBe(50);
  });

  it('cancel() fires the onCancel callback and returns true for a running job', () => {
    const registry = new JobRegistry();
    const id = registry.create();
    registry.markRunning(id, 100);

    let cancelledCallbackFired = false;
    registry.setOnCancel(id, () => {
      cancelledCallbackFired = true;
    });

    expect(registry.isCancelled(id)).toBe(false);
    const result = registry.cancel(id);
    expect(result).toBe(true);
    expect(cancelledCallbackFired).toBe(true);
    expect(registry.isCancelled(id)).toBe(true);
  });

  it('cancel() returns false for an already-finished job and for unknown ids', () => {
    const registry = new JobRegistry();
    const id = registry.create();
    registry.markDone(id);
    expect(registry.cancel(id)).toBe(false);
    expect(registry.cancel('nope')).toBe(false);
  });
});
