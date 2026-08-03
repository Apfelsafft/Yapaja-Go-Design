import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../bus/index.js';
import {
  MAX_SECURITY_EVENTS,
  SECURITY_VECTORS,
  SecurityEventLog,
  isSecurityVector,
  redactDetail,
  type SecurityViolation,
} from './securityEvents.js';

/**
 * Unit coverage for the `security` event channel itself (E09-T6). The
 * per-vector, against-a-real-Core coverage lives in `e2e/security/`; this file
 * only pins down the recorder's own contract: bounded retention, the three
 * outputs (buffer + bus + log), secret redaction, and the fact that a broken
 * sink can never break an enforcement path.
 */

describe('SecurityEventLog', () => {
  it('records into the ring buffer, publishes on the bus, and logs at warn', () => {
    const bus = new EventBus();
    const received: SecurityViolation[] = [];
    bus.subscribe('event/security_violation', (payload) => received.push(payload as SecurityViolation));
    const warn = vi.fn();
    const log = new SecurityEventLog({ bus, logger: { warn } });

    const violation = log.record('core.scope_denied', 'com.example.evil', 'GET /api/v1/settings');

    expect(violation.vector).toBe('core.scope_denied');
    expect(violation.addonId).toBe('com.example.evil');
    expect(violation.detail).toBe('GET /api/v1/settings');
    expect(Date.parse(violation.at)).not.toBeNaN();

    expect(log.list()).toEqual([violation]);
    expect(received).toEqual([violation]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toBe('security violation blocked');
  });

  it('is bounded -- the oldest entries are dropped, never the newest', () => {
    const log = new SecurityEventLog({ maxEntries: 3 });
    for (const n of [1, 2, 3, 4, 5]) log.record('core.scope_denied', 'a', `attempt ${n}`);
    expect(log.size).toBe(3);
    expect(log.list().map((e) => e.detail)).toEqual(['attempt 3', 'attempt 4', 'attempt 5']);
  });

  it('defaults to a 500-entry ring buffer', () => {
    const log = new SecurityEventLog();
    for (let i = 0; i < MAX_SECURITY_EVENTS + 10; i++) log.record('core.scope_denied', 'a', `n${i}`);
    expect(log.size).toBe(MAX_SECURITY_EVENTS);
  });

  it('normalizes an empty/missing add-on id to null', () => {
    const log = new SecurityEventLog();
    expect(log.record('tarball.symlink', '', 'x').addonId).toBeNull();
    expect(log.record('tarball.symlink', null, 'x').addonId).toBeNull();
  });

  it('filters by vector, add-on id and limit', () => {
    const log = new SecurityEventLog();
    log.record('core.scope_denied', 'a', '1');
    log.record('egress.host_not_declared', 'a', '2');
    log.record('core.scope_denied', 'b', '3');
    log.record('core.scope_denied', 'a', '4');

    expect(log.list({ vector: 'core.scope_denied' }).map((e) => e.detail)).toEqual(['1', '3', '4']);
    expect(log.list({ addonId: 'a' }).map((e) => e.detail)).toEqual(['1', '2', '4']);
    expect(log.list({ vector: 'core.scope_denied', addonId: 'a' }).map((e) => e.detail)).toEqual(['1', '4']);
    // `limit` keeps the NEWEST n.
    expect(log.list({ limit: 2 }).map((e) => e.detail)).toEqual(['3', '4']);
  });

  it('NEVER stores a token even if a careless caller passes one', () => {
    const log = new SecurityEventLog();
    const entry = log.record(
      'token.replay_after_disable',
      'com.example.evil',
      'presented Authorization: Bearer s3cr3t-token-value while disabled',
    );
    expect(entry.detail).not.toContain('s3cr3t-token-value');
    expect(entry.detail).toContain('<redacted>');
  });

  it('a throwing logger or bus subscriber never breaks recording', () => {
    const bus = new EventBus();
    bus.subscribe('event/security_violation', () => {
      throw new Error('subscriber blew up');
    });
    const log = new SecurityEventLog({
      bus,
      logger: {
        warn: () => {
          throw new Error('logger blew up');
        },
      },
    });
    expect(() => log.record('fs.outside_datadir', 'a', 'denied')).not.toThrow();
    expect(log.size).toBe(1);
  });

  it('records into the buffer even before a bus/logger has been configured', () => {
    const log = new SecurityEventLog();
    log.record('bridge.unknown_method', 'a', 'early');
    const bus = new EventBus();
    const received: unknown[] = [];
    bus.subscribe('event/security_violation', (p) => received.push(p));
    log.configure({ bus });
    log.record('bridge.unknown_method', 'a', 'late');

    expect(log.list().map((e) => e.detail)).toEqual(['early', 'late']);
    // Only the post-configure one is published -- nothing is replayed.
    expect(received).toHaveLength(1);
  });
});

describe('redactDetail', () => {
  it.each([
    ['Bearer abc123', 'Bearer=<redacted>'],
    ['token=abc123', 'token=<redacted>'],
    ['password: hunter2', 'password=<redacted>'],
    ['api_key=xyz', 'api_key=<redacted>'],
  ])('redacts %s', (input, expected) => {
    expect(redactDetail(input)).toBe(expected);
  });

  it('collapses whitespace and truncates over-long details', () => {
    expect(redactDetail('  a\n\n  b  ')).toBe('a b');
    const long = redactDetail('x'.repeat(1000));
    expect(long.length).toBeLessThanOrEqual(400);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('SECURITY_VECTORS', () => {
  it('has no duplicates', () => {
    expect(new Set(SECURITY_VECTORS).size).toBe(SECURITY_VECTORS.length);
  });

  it('covers every vector the E09-T6 suite asserts on', () => {
    // The task-mandated minimum set. A future task that removes one of these
    // breaks HERE, not silently in the e2e suite.
    const required = [
      'bridge.unknown_method',
      'core.scope_denied',
      'egress.host_not_declared',
      'storage.foreign_namespace',
      'fs.outside_datadir',
      'route.activate_without_confirm',
      'token.replay_after_disable',
      'tarball.path_traversal',
      'tarball.symlink',
      'tarball.zip_bomb',
      'ui.parent_dom_access',
      'ui.foreign_host_fetch',
      'events.foreign_topic',
    ];
    for (const vector of required) {
      expect(SECURITY_VECTORS as readonly string[]).toContain(vector);
    }
  });

  it('isSecurityVector rejects anything not in the list', () => {
    expect(isSecurityVector('core.scope_denied')).toBe(true);
    expect(isSecurityVector('core.scope_granted')).toBe(false);
    expect(isSecurityVector(42)).toBe(false);
    expect(isSecurityVector(undefined)).toBe(false);
  });
});
