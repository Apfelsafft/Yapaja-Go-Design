/**
 * Unit tests for `driveLockStore.ts`: the store wiring around the pure
 * `driveLock.ts` logic (real timers via fake-timer control, threshold
 * boot-load). Runs under Node (`vitest.config.ts` `environment: 'node'`) --
 * `typeof window === 'undefined'` there, so the module-scope
 * `usePositionStore` subscription / `sessionStorage` persistence are no-ops
 * (mirrors `themeStore.test.ts`'s identical Node-env scope note); the
 * REAL sessionStorage "remembered for the session" round-trip is covered by
 * `apps/web/e2e/drive-lock.spec.ts` instead, where a real `window` exists.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDriveLockStore } from './driveLockStore.js';
import { DEFAULT_DRIVE_LOCK_KMH, PASSENGER_COUNTDOWN_MS } from './driveLock.js';

describe('driveLockStore', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: {} }) }));
    useDriveLockStore.setState({
      thresholdKmh: DEFAULT_DRIVE_LOCK_KMH,
      ready: false,
      speedMps: null,
      passengerOverride: { active: false, countdownStartedAt: null },
      countdownRemainingMs: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('init() loads the persisted threshold and flips ready', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: { driveLock: { thresholdKmh: 25 } } }) }),
    );
    await useDriveLockStore.getState().init();
    expect(useDriveLockStore.getState().thresholdKmh).toBe(25);
    expect(useDriveLockStore.getState().ready).toBe(true);
  });

  it('init() falls back to the default threshold when nothing is persisted', async () => {
    await useDriveLockStore.getState().init();
    expect(useDriveLockStore.getState().thresholdKmh).toBe(DEFAULT_DRIVE_LOCK_KMH);
  });

  it('setThresholdKmh updates state immediately (persistence itself covered by driveLockClient.test.ts)', () => {
    useDriveLockStore.getState().setThresholdKmh(15);
    expect(useDriveLockStore.getState().thresholdKmh).toBe(15);
  });

  it('isLocked delegates to isControlLocked with the live speed/threshold/override', () => {
    useDriveLockStore.getState()._setSpeedMps(50 / 3.6); // 50 km/h, above default 10
    expect(useDriveLockStore.getState().isLocked('settings')).toBe(true);
    expect(useDriveLockStore.getState().isLocked('drive-stop')).toBe(false); // SAFETY INVARIANT holds through the store too
  });

  it('isLocked is unlocked below the threshold', () => {
    useDriveLockStore.getState()._setSpeedMps(0);
    expect(useDriveLockStore.getState().isLocked('settings')).toBe(false);
  });

  describe('passenger-override countdown (real timers via fake-timer control)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('startPassengerOverride begins a countdown that has not yet activated', () => {
      useDriveLockStore.getState().startPassengerOverride();
      expect(useDriveLockStore.getState().passengerOverride.active).toBe(false);
      expect(useDriveLockStore.getState().countdownRemainingMs).toBe(PASSENGER_COUNTDOWN_MS);
    });

    it(`activates after ${PASSENGER_COUNTDOWN_MS}ms of real elapsed time`, () => {
      useDriveLockStore.getState().startPassengerOverride();
      vi.advanceTimersByTime(PASSENGER_COUNTDOWN_MS + 50);
      expect(useDriveLockStore.getState().passengerOverride.active).toBe(true);
      expect(useDriveLockStore.getState().countdownRemainingMs).toBeNull();
    });

    it('does not activate before the 5s elapse', () => {
      useDriveLockStore.getState().startPassengerOverride();
      vi.advanceTimersByTime(PASSENGER_COUNTDOWN_MS - 500);
      expect(useDriveLockStore.getState().passengerOverride.active).toBe(false);
      expect(useDriveLockStore.getState().countdownRemainingMs).toBeGreaterThan(0);
    });

    it('cancelPassengerOverrideCountdown stops the countdown and never activates it', () => {
      useDriveLockStore.getState().startPassengerOverride();
      vi.advanceTimersByTime(2_000);
      useDriveLockStore.getState().cancelPassengerOverrideCountdown();
      expect(useDriveLockStore.getState().countdownRemainingMs).toBeNull();

      vi.advanceTimersByTime(PASSENGER_COUNTDOWN_MS);
      expect(useDriveLockStore.getState().passengerOverride.active).toBe(false);
    });

    it('once active, isLocked unlocks every gated surface even above the threshold', () => {
      useDriveLockStore.getState()._setSpeedMps(100 / 3.6);
      useDriveLockStore.getState().startPassengerOverride();
      vi.advanceTimersByTime(PASSENGER_COUNTDOWN_MS + 50);

      expect(useDriveLockStore.getState().isLocked('settings')).toBe(false);
      expect(useDriveLockStore.getState().isLocked('editor')).toBe(false);
      expect(useDriveLockStore.getState().isLocked('store')).toBe(false);
      expect(useDriveLockStore.getState().isLocked('profile-editor')).toBe(false);
      expect(useDriveLockStore.getState().isLocked('search-full')).toBe(false);
      // SAFETY INVARIANT: drive-stop was never locked in the first place,
      // override or not.
      expect(useDriveLockStore.getState().isLocked('drive-stop')).toBe(false);
    });
  });
});
