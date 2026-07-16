/**
 * State-machine table test (E04-T1): asserts EVERY (state, action) cell —
 * both the valid transitions and that all others are rejected (null → 409).
 */

import { describe, it, expect } from 'vitest';
import {
  nextState,
  canTransition,
  NAV_STATUSES,
  NAV_ACTIONS,
  type NavStatus,
  type NavAction,
} from './stateMachine.js';

// The full expected table. `undefined` means "invalid transition".
const EXPECTED: Record<NavStatus, Partial<Record<NavAction, NavStatus>>> = {
  idle: { START: 'routing' },
  routing: { ROUTE_READY: 'navigating', STOP: 'idle' },
  navigating: { PAUSE: 'paused', DEVIATE: 'off_route', ARRIVE: 'arrived', STOP: 'idle' },
  off_route: { RETURN: 'navigating', PAUSE: 'paused', ARRIVE: 'arrived', STOP: 'idle' },
  paused: { RESUME: 'navigating', STOP: 'idle' },
  arrived: { START: 'routing', STOP: 'idle' },
};

describe('navigation state machine', () => {
  it('every (state, action) cell matches the authoritative table', () => {
    for (const state of NAV_STATUSES) {
      for (const action of NAV_ACTIONS) {
        const expected = EXPECTED[state][action] ?? null;
        expect(nextState(state, action), `${state} + ${action}`).toBe(expected);
        expect(canTransition(state, action), `${state} + ${action}`).toBe(expected !== null);
      }
    }
  });

  it('rejects every invalid transition (would be HTTP 409)', () => {
    const invalidSamples: Array<[NavStatus, NavAction]> = [
      ['idle', 'PAUSE'],
      ['idle', 'RESUME'],
      ['idle', 'STOP'],
      ['navigating', 'START'],
      ['navigating', 'RESUME'],
      ['paused', 'PAUSE'],
      ['paused', 'START'],
      ['arrived', 'PAUSE'],
      ['arrived', 'RESUME'],
      ['off_route', 'RESUME'],
      ['off_route', 'START'],
    ];
    for (const [state, action] of invalidSamples) {
      expect(nextState(state, action), `${state} + ${action}`).toBeNull();
    }
  });

  it('models the start flow idle → routing → navigating', () => {
    expect(nextState('idle', 'START')).toBe('routing');
    expect(nextState('routing', 'ROUTE_READY')).toBe('navigating');
  });

  it('off_route is a sub-state reachable only from navigating and returns to it', () => {
    expect(nextState('navigating', 'DEVIATE')).toBe('off_route');
    expect(nextState('off_route', 'RETURN')).toBe('navigating');
    expect(nextState('paused', 'DEVIATE')).toBeNull();
    expect(nextState('idle', 'DEVIATE')).toBeNull();
  });
});
