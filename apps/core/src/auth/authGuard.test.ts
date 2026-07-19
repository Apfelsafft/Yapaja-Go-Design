/**
 * Unit tests for `AuthGuard` (E08-T3): the enforcement decision + constant-time
 * verification, token precedence (env over settings), and ingress bypass.
 */

import { describe, it, expect } from 'vitest';
import {
  AuthGuard,
  AUTH_TOKEN_SETTINGS_KEY,
  parseBearerToken,
  parseCookieToken,
  extractWsToken,
} from './authGuard.js';

function settingsWith(token: string | undefined): { get(key: string): unknown } {
  return { get: (key) => (key === AUTH_TOKEN_SETTINGS_KEY ? token : undefined) };
}

describe('AuthGuard enforcement decision', () => {
  it('is OPEN when no token is configured anywhere', () => {
    const guard = new AuthGuard({ env: {} });
    expect(guard.isEnforced()).toBe(false);
    // verify() returns true (allowed) in the open posture.
    expect(guard.verify(undefined)).toBe(true);
  });

  it('is ENFORCED when a settings token is set', () => {
    const guard = new AuthGuard({ settings: settingsWith('s3cr3t'), env: {} });
    expect(guard.isEnforced()).toBe(true);
  });

  it('is ENFORCED when env API_AUTH_TOKEN is set', () => {
    const guard = new AuthGuard({ env: { API_AUTH_TOKEN: 's3cr3t' } });
    expect(guard.isEnforced()).toBe(true);
  });

  it('env token takes PRECEDENCE over settings token', () => {
    const guard = new AuthGuard({
      settings: settingsWith('from-settings'),
      env: { API_AUTH_TOKEN: 'from-env' },
    });
    expect(guard.getConfiguredToken()).toBe('from-env');
    expect(guard.verify('from-env')).toBe(true);
    expect(guard.verify('from-settings')).toBe(false);
  });

  it('ingress mode disables enforcement even with a token configured', () => {
    const guard = new AuthGuard({
      settings: settingsWith('s3cr3t'),
      env: { INGRESS_MODE: '1' },
    });
    expect(guard.isIngressMode()).toBe(true);
    expect(guard.isEnforced()).toBe(false);
    expect(guard.verify(undefined)).toBe(true); // bypassed
  });

  it('INGRESS_MODE only counts for "1"/"true"', () => {
    expect(new AuthGuard({ env: { INGRESS_MODE: '0' } }).isIngressMode()).toBe(false);
    expect(new AuthGuard({ env: { INGRESS_MODE: 'true' } }).isIngressMode()).toBe(true);
    expect(new AuthGuard({ env: { INGRESS_MODE: 'yes' } }).isIngressMode()).toBe(false);
  });
});

describe('AuthGuard.verify (constant-time)', () => {
  const guard = new AuthGuard({ env: { API_AUTH_TOKEN: 'correct-horse-battery' } });

  it('accepts the exact token', () => {
    expect(guard.verify('correct-horse-battery')).toBe(true);
  });

  it('rejects a wrong token of equal length', () => {
    expect(guard.verify('correct-horse-batterX')).toBe(false);
  });

  it('rejects a wrong-length token (length guard before timingSafeEqual)', () => {
    expect(guard.verify('short')).toBe(false);
    expect(guard.verify('correct-horse-battery-and-then-some')).toBe(false);
  });

  it('rejects null / undefined / empty', () => {
    expect(guard.verify(null)).toBe(false);
    expect(guard.verify(undefined)).toBe(false);
    expect(guard.verify('')).toBe(false);
  });
});

describe('token extraction helpers', () => {
  it('parseBearerToken parses "Bearer <token>" case-insensitively', () => {
    expect(parseBearerToken('Bearer abc123')).toBe('abc123');
    expect(parseBearerToken('bearer abc123')).toBe('abc123');
    expect(parseBearerToken('  Bearer   abc123  ')).toBe('abc123');
    expect(parseBearerToken('Basic abc123')).toBeNull();
    expect(parseBearerToken('abc123')).toBeNull();
    expect(parseBearerToken(undefined)).toBeNull();
    expect(parseBearerToken(['Bearer a', 'Bearer b'])).toBeNull();
  });

  it('parseCookieToken reads the "token" cookie', () => {
    expect(parseCookieToken('token=abc123')).toBe('abc123');
    expect(parseCookieToken('foo=1; token=abc123; bar=2')).toBe('abc123');
    expect(parseCookieToken('foo=1')).toBeNull();
    expect(parseCookieToken(undefined)).toBeNull();
  });

  it('extractWsToken prefers the query token, falls back to cookie', () => {
    expect(extractWsToken({ token: 'q' }, 'token=c')).toBe('q');
    expect(extractWsToken({}, 'token=c')).toBe('c');
    expect(extractWsToken(undefined, 'token=c')).toBe('c');
    expect(extractWsToken({ token: '' }, 'token=c')).toBe('c');
    expect(extractWsToken({}, undefined)).toBeNull();
  });
});
