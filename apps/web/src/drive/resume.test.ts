/**
 * Unit tests for the W-19 reload-recovery boot check (E04-T5).
 * `getNavigationState` is mocked so every case (already navigating, idle
 * with a recovered route, nothing to recover, a failed check) is exercised
 * deterministically without a real Core.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NavState } from '@yapaja/shared';

vi.mock('./client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client.js')>();
  return {
    ...actual,
    getNavigationState: vi.fn(),
  };
});

import { checkResumeOnLoad } from './resume.js';
import { useNavStore } from './navStore.js';
import * as client from './client.js';

const getNavigationStateMock = client.getNavigationState as unknown as ReturnType<typeof vi.fn>;

function makeNavState(overrides: Partial<NavState> = {}): NavState {
  return {
    status: 'idle',
    route_id: null,
    next_maneuver: null,
    distance_to_maneuver_m: null,
    distance_remaining_m: null,
    duration_remaining_s: null,
    eta: null,
    speed_kmh: null,
    speed_limit_kmh: null,
    altitude_m: null,
    destination: null,
    ...overrides,
  };
}

describe('checkResumeOnLoad (W-19)', () => {
  beforeEach(() => {
    useNavStore.setState({ resumeAcknowledged: true, pendingResume: null });
    getNavigationStateMock.mockReset();
  });

  it('an already-active session (navigating/off_route/paused) -> pendingResume kind "active", gate closed', async () => {
    const navState = makeNavState({ status: 'navigating', route_id: 'r1' });
    getNavigationStateMock.mockResolvedValue({ navState, recoveredRoute: null });

    await checkResumeOnLoad();

    expect(useNavStore.getState().resumeAcknowledged).toBe(false);
    expect(useNavStore.getState().pendingResume).toEqual({ kind: 'active', state: navState });
  });

  it('paused also counts as an already-active session', async () => {
    const navState = makeNavState({ status: 'paused', route_id: 'r1' });
    getNavigationStateMock.mockResolvedValue({ navState, recoveredRoute: null });

    await checkResumeOnLoad();

    expect(useNavStore.getState().pendingResume).toEqual({ kind: 'active', state: navState });
  });

  it('idle with a recovered route -> pendingResume kind "recovered", gate closed', async () => {
    const navState = makeNavState({ status: 'idle' });
    const destination = { latlng: { lat: 47.1, lon: 9.5 }, name: 'Ziel' };
    getNavigationStateMock.mockResolvedValue({
      navState,
      recoveredRoute: { route_id: 'cached-1', destination },
    });

    await checkResumeOnLoad();

    expect(useNavStore.getState().resumeAcknowledged).toBe(false);
    expect(useNavStore.getState().pendingResume).toEqual({
      kind: 'recovered',
      route_id: 'cached-1',
      destination,
    });
  });

  it('idle with nothing to recover -> gate stays open, no prompt', async () => {
    getNavigationStateMock.mockResolvedValue({ navState: makeNavState({ status: 'idle' }), recoveredRoute: null });

    await checkResumeOnLoad();

    expect(useNavStore.getState().resumeAcknowledged).toBe(true);
    expect(useNavStore.getState().pendingResume).toBeNull();
  });

  it('arrived status -> gate stays open (arrival is not a resumable session)', async () => {
    getNavigationStateMock.mockResolvedValue({ navState: makeNavState({ status: 'arrived' }), recoveredRoute: null });

    await checkResumeOnLoad();

    expect(useNavStore.getState().resumeAcknowledged).toBe(true);
    expect(useNavStore.getState().pendingResume).toBeNull();
  });

  it('a failed check fails OPEN -- never blocks the app on a broken reload-recovery request', async () => {
    getNavigationStateMock.mockRejectedValue(new Error('network down'));

    await checkResumeOnLoad();

    expect(useNavStore.getState().resumeAcknowledged).toBe(true);
    expect(useNavStore.getState().pendingResume).toBeNull();
  });
});
