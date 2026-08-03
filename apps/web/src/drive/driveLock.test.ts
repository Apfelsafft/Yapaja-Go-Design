import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DRIVE_LOCK_KMH,
  INITIAL_PASSENGER_OVERRIDE_STATE,
  PASSENGER_COUNTDOWN_MS,
  cancelPassengerCountdown,
  isControlLocked,
  isSpeedLocked,
  remainingCountdownMs,
  startPassengerCountdown,
  tickPassengerCountdown,
  type PassengerOverrideState,
} from './driveLock.js';

describe('isSpeedLocked (configurable threshold)', () => {
  it('is unlocked when speed is null (no fix / unknown)', () => {
    expect(isSpeedLocked(null)).toBe(false);
  });

  it('is unlocked when speed is undefined', () => {
    expect(isSpeedLocked(undefined)).toBe(false);
  });

  it('is unlocked at 0 m/s', () => {
    expect(isSpeedLocked(0)).toBe(false);
  });

  it(`defaults to the ${DEFAULT_DRIVE_LOCK_KMH} km/h threshold when none is given`, () => {
    const justAbove = DEFAULT_DRIVE_LOCK_KMH / 3.6 + 0.01;
    expect(isSpeedLocked(justAbove)).toBe(true);
  });

  it('is unlocked exactly AT a custom threshold', () => {
    const speedMps = 20 / 3.6;
    expect(isSpeedLocked(speedMps, 20)).toBe(false);
  });

  it('is locked just above a custom threshold', () => {
    const speedMps = 20 / 3.6 + 0.01;
    expect(isSpeedLocked(speedMps, 20)).toBe(true);
  });

  it('a lower configured threshold locks at a speed the default would not', () => {
    const speedMps = 6 / 3.6; // 6 km/h
    expect(isSpeedLocked(speedMps, DEFAULT_DRIVE_LOCK_KMH)).toBe(false);
    expect(isSpeedLocked(speedMps, 5)).toBe(true);
  });
});

describe('isControlLocked -- SAFETY INVARIANT: drive-stop is NEVER locked', () => {
  it('is unlocked at high speed, no override', () => {
    expect(isControlLocked('drive-stop', { speedMps: 200 / 3.6 })).toBe(false);
  });

  it('is unlocked at a low/unknown speed too (trivially, but asserted for completeness)', () => {
    expect(isControlLocked('drive-stop', { speedMps: null })).toBe(false);
    expect(isControlLocked('drive-stop', { speedMps: 0 })).toBe(false);
  });

  it('is unlocked across a whole sweep of speeds -- unconditional, not "because it happens to be slow"', () => {
    for (const kmh of [0, 1, 5, 9.99, 10, 10.01, 30, 80, 130, 300]) {
      expect(isControlLocked('drive-stop', { speedMps: kmh / 3.6 })).toBe(false);
    }
  });

  it('is unlocked even with an explicit threshold of 0 (would lock everything else at any speed > 0)', () => {
    expect(isControlLocked('drive-stop', { speedMps: 1, thresholdKmh: 0 })).toBe(false);
  });

  it('is unlocked regardless of passengerOverrideActive (true or false/undefined)', () => {
    expect(isControlLocked('drive-stop', { speedMps: 200 / 3.6, passengerOverrideActive: false })).toBe(false);
    expect(isControlLocked('drive-stop', { speedMps: 200 / 3.6, passengerOverrideActive: true })).toBe(false);
  });
});

describe('isControlLocked -- Pause/Resume (documented decision: never locked either)', () => {
  it('drive-pause is unlocked at any speed', () => {
    expect(isControlLocked('drive-pause', { speedMps: 200 / 3.6 })).toBe(false);
  });

  it('drive-resume is unlocked at any speed', () => {
    expect(isControlLocked('drive-resume', { speedMps: 200 / 3.6 })).toBe(false);
  });
});

describe('isControlLocked -- configuration surfaces (settings/editor/store/addon-store/profile-editor/search-full)', () => {
  const surfaces = ['settings', 'editor', 'store', 'addon-store', 'profile-editor', 'search-full'] as const;

  it('are unlocked below/at the threshold', () => {
    for (const controlId of surfaces) {
      expect(isControlLocked(controlId, { speedMps: 0 })).toBe(false);
      expect(isControlLocked(controlId, { speedMps: DEFAULT_DRIVE_LOCK_KMH / 3.6 })).toBe(false);
    }
  });

  it('are locked above the threshold', () => {
    for (const controlId of surfaces) {
      expect(isControlLocked(controlId, { speedMps: (DEFAULT_DRIVE_LOCK_KMH + 1) / 3.6 })).toBe(true);
    }
  });

  it('respect a configured (non-default) threshold', () => {
    for (const controlId of surfaces) {
      expect(isControlLocked(controlId, { speedMps: 12 / 3.6, thresholdKmh: 15 })).toBe(false);
      expect(isControlLocked(controlId, { speedMps: 16 / 3.6, thresholdKmh: 15 })).toBe(true);
    }
  });

  it('an active passenger override lifts the lock even above the threshold', () => {
    for (const controlId of surfaces) {
      expect(
        isControlLocked(controlId, { speedMps: 100 / 3.6, passengerOverrideActive: true }),
      ).toBe(false);
    }
  });

  it('null/undefined speed (no fix) never locks a config surface', () => {
    for (const controlId of surfaces) {
      expect(isControlLocked(controlId, { speedMps: null })).toBe(false);
      expect(isControlLocked(controlId, { speedMps: undefined })).toBe(false);
    }
  });
});

describe('Passenger-override state machine (pure, 5s countdown + session-remember)', () => {
  it('starts inactive with no countdown running', () => {
    expect(INITIAL_PASSENGER_OVERRIDE_STATE).toEqual({ active: false, countdownStartedAt: null });
  });

  it('starting a countdown records the start time but does not activate yet', () => {
    const started = startPassengerCountdown(INITIAL_PASSENGER_OVERRIDE_STATE, 1_000);
    expect(started).toEqual({ active: false, countdownStartedAt: 1_000 });
  });

  it(`does NOT activate before ${PASSENGER_COUNTDOWN_MS}ms have elapsed`, () => {
    const started = startPassengerCountdown(INITIAL_PASSENGER_OVERRIDE_STATE, 0);
    const ticked = tickPassengerCountdown(started, PASSENGER_COUNTDOWN_MS - 1);
    expect(ticked.active).toBe(false);
    expect(ticked.countdownStartedAt).toBe(0);
  });

  it(`activates exactly AT ${PASSENGER_COUNTDOWN_MS}ms elapsed`, () => {
    const started = startPassengerCountdown(INITIAL_PASSENGER_OVERRIDE_STATE, 0);
    const ticked = tickPassengerCountdown(started, PASSENGER_COUNTDOWN_MS);
    expect(ticked).toEqual({ active: true, countdownStartedAt: null });
  });

  it('activates when well past the countdown too', () => {
    const started = startPassengerCountdown(INITIAL_PASSENGER_OVERRIDE_STATE, 0);
    const ticked = tickPassengerCountdown(started, PASSENGER_COUNTDOWN_MS + 60_000);
    expect(ticked.active).toBe(true);
  });

  it('ticking with no countdown running is a no-op', () => {
    expect(tickPassengerCountdown(INITIAL_PASSENGER_OVERRIDE_STATE, 999_999)).toEqual(
      INITIAL_PASSENGER_OVERRIDE_STATE,
    );
  });

  it('ticking once already active is a no-op (stays active, no re-triggering)', () => {
    const active: PassengerOverrideState = { active: true, countdownStartedAt: null };
    expect(tickPassengerCountdown(active, 0)).toEqual(active);
  });

  it('canceling a countdown clears countdownStartedAt without touching active', () => {
    const started = startPassengerCountdown(INITIAL_PASSENGER_OVERRIDE_STATE, 500);
    const canceled = cancelPassengerCountdown(started);
    expect(canceled).toEqual({ active: false, countdownStartedAt: null });
  });

  it('a canceled countdown never later activates on a stale tick', () => {
    const started = startPassengerCountdown(INITIAL_PASSENGER_OVERRIDE_STATE, 0);
    const canceled = cancelPassengerCountdown(started);
    const ticked = tickPassengerCountdown(canceled, PASSENGER_COUNTDOWN_MS + 1_000);
    expect(ticked.active).toBe(false);
  });

  describe('remainingCountdownMs', () => {
    it('is null when no countdown is running', () => {
      expect(remainingCountdownMs(INITIAL_PASSENGER_OVERRIDE_STATE, 0)).toBeNull();
    });

    it('counts down toward 0', () => {
      const started = startPassengerCountdown(INITIAL_PASSENGER_OVERRIDE_STATE, 1_000);
      expect(remainingCountdownMs(started, 1_000)).toBe(PASSENGER_COUNTDOWN_MS);
      expect(remainingCountdownMs(started, 1_000 + 2_000)).toBe(PASSENGER_COUNTDOWN_MS - 2_000);
    });

    it('clamps at 0, never negative', () => {
      const started = startPassengerCountdown(INITIAL_PASSENGER_OVERRIDE_STATE, 0);
      expect(remainingCountdownMs(started, PASSENGER_COUNTDOWN_MS + 10_000)).toBe(0);
    });
  });
});
