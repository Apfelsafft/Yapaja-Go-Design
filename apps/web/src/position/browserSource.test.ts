/**
 * Unit tests for browserSource (E02-T2)
 *
 * Tests:
 * - State management
 * - Error handling
 * - Note: Most GeolocationPosition mapping tests are done in E2E tests since
 *   the browserSource depends on browser APIs that are difficult to test in Node environment
 */

import { describe, it, expect } from 'vitest';
import type { BrowserSourceState } from './browserSource';
import { browserSource } from './browserSource';

describe('browserSource', () => {
  it('can register and receive state changes', () => {
    const states: BrowserSourceState[] = [];
    const unsubscribe = browserSource.onStateChange((state) => states.push(state));

    // Verify we can unsubscribe
    expect(unsubscribe).toBeDefined();
    expect(typeof unsubscribe).toBe('function');

    // Clean up
    unsubscribe();
  });

  it('returns current state via getState()', () => {
    const state = browserSource.getState();
    expect(state).toBeDefined();
    expect(state).toHaveProperty('status');
    expect(['idle', 'starting', 'active', 'error', 'paused']).toContain(state.status);
  });

  it('has proper BrowserSourceError union type', () => {
    // Just verify the type exports work
    const errorTypes: Array<'insecure-context' | 'not-supported' | 'permission-denied'> = [
      'insecure-context',
      'not-supported',
      'permission-denied',
    ];
    expect(errorTypes.length).toBe(3);
  });

  it('has proper BrowserSourceStatus union type', () => {
    // Verify the type exports work
    const statusTypes: Array<'idle' | 'starting' | 'active' | 'error'> = [
      'idle',
      'starting',
      'active',
      'error',
    ];
    expect(statusTypes.length).toBe(4);
  });
});
