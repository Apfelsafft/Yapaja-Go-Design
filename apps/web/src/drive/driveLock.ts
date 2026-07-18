/**
 * Generalized, configurable Speed-Lock predicate (E07-T4, docs/06 §4): above
 * a configurable speed (default 10 km/h), the interactive/config surfaces
 * (Settings, the layout Editor, the region/map Store panel, the Profile
 * editor) and the full search field are locked behind an overlay. This
 * module is the pure, DOM-free decision logic -- mirrors `layout.ts`'s /
 * `editModel.ts`'s "zero DOM/React/store dependencies" boundary so the rules
 * here (especially the SAFETY INVARIANT below) are trivially unit-testable.
 *
 * Generalizes `search/speedLock.ts`'s original fixed-10-km/h
 * `isSearchSpeedLocked` (E05-T2 "Speed-Lock-Vorgriff") into a
 * threshold-parameterized predicate; `search/speedLock.ts` now delegates
 * here (kept for its own existing unit tests + as the search-specific
 * default-threshold constant), and `SearchBar.tsx` uses `isSpeedLocked`
 * directly with the CONFIGURED threshold from `driveLockStore.ts` (not the
 * fixed default) so a user-configured threshold actually affects search too.
 */

/** Default speed-lock threshold in km/h (task spec: "Default 10 km/h").
 *  Configurable via the settings service (`driveLockClient.ts`, key
 *  `driveLock` -> `{ thresholdKmh }`). */
export const DEFAULT_DRIVE_LOCK_KMH = 10;

/** `speedMps` is `Position.speed` (m/s), or `null`/`undefined` when unknown
 *  (no fix yet, or the source doesn't report speed) -- treated as "not
 *  moving" (unlocked), the safe default absent better information (same
 *  contract `search/speedLock.ts#isSearchSpeedLocked` already established).
 *  Strictly GREATER THAN the threshold locks -- exactly AT the threshold is
 *  still unlocked (matches the pre-existing search behavior/tests). */
export function isSpeedLocked(
  speedMps: number | null | undefined,
  thresholdKmh: number = DEFAULT_DRIVE_LOCK_KMH,
): boolean {
  if (speedMps === null || speedMps === undefined) {
    return false;
  }
  const speedKmh = speedMps * 3.6;
  return speedKmh > thresholdKmh;
}

/**
 * The interactive/config surfaces the Speed-Lock gates (docs/06 §4:
 * "komplexe Dialoge (Profil-Editor, Settings, Store) gesperrt"), plus the
 * drive-mode navigation controls (which the SAFETY INVARIANT below carves an
 * exception out of, for `drive-stop` unconditionally).
 *
 * Deliberately a closed, explicit union (not a free-form string) -- every
 * caller of `isControlLocked` names exactly which surface it's asking about,
 * so a typo/new surface can never silently fall through to "locked"/
 * "unlocked" by accident.
 */
export type DriveControlId =
  | 'drive-stop'
  | 'drive-pause'
  | 'drive-resume'
  | 'settings'
  | 'editor'
  | 'store'
  | 'profile-editor'
  | 'search-full';

export interface DriveLockContext {
  /** `Position.speed` (m/s), or `null`/`undefined` when unknown. */
  speedMps: number | null | undefined;
  /** The configured Speed-Lock threshold (km/h). Defaults to `DEFAULT_DRIVE_LOCK_KMH`. */
  thresholdKmh?: number;
  /** Whether the "Ich bin Beifahrer" passenger override is currently active
   *  (5-s countdown elapsed, remembered for the session -- see
   *  `PassengerOverrideState` below). An active override lifts every lock
   *  EXCEPT the ones that are never locked in the first place. */
  passengerOverrideActive?: boolean;
}

/**
 * THE lock decision for one control/surface.
 *
 * SAFETY INVARIANT (do NOT violate -- task's explicit "Plausibilität"): the
 * Stop-Navigation control (`data-testid="drive-stop-button"`,
 * `apps/web/src/drive/DriveControls.tsx`) is NEVER locked/disabled/covered
 * by the Speed-Lock overlay, at ANY speed. This is expressed here as an
 * UNCONDITIONAL early return -- `'drive-stop'` never even reaches the
 * speed/override logic below, so it can never become locked "by accident"
 * through some future change to that logic (e.g. a bug in threshold
 * handling, or a passenger-override state that somehow defaults to
 * inactive). A driver must always be able to stop navigation.
 *
 * Pause/Resume decision (documented, task's "your call"): `'drive-pause'`
 * and `'drive-resume'` are ALSO never locked by Speed-Lock, for the same
 * safety-spirit reason as Stop -- they are momentary, safety-relevant
 * navigation controls (e.g. pausing guidance after pulling over, or
 * resuming it), not "complex dialogs" (docs/06 §4's own scoping language:
 * "komplexe Dialoge (Profil-Editor, Settings, Store) gesperrt"). Only the
 * genuine CONFIGURATION surfaces -- Settings, the layout Editor, the
 * region/map Store panel, the Profile editor, and the full search field --
 * are gated behind the overlay.
 */
export function isControlLocked(controlId: DriveControlId, ctx: DriveLockContext): boolean {
  // SAFETY INVARIANT: unconditional, never reaches the logic below.
  if (controlId === 'drive-stop') {
    return false;
  }
  if (controlId === 'drive-pause' || controlId === 'drive-resume') {
    return false; // documented decision above -- momentary nav controls, not config surfaces.
  }
  if (ctx.passengerOverrideActive) {
    return false;
  }
  return isSpeedLocked(ctx.speedMps, ctx.thresholdKmh);
}

/**
 * Passenger-override state machine ("Ich bin Beifahrer"): a 5-second
 * countdown that, once elapsed, activates the override for the rest of the
 * session (`driveLockStore.ts` persists `active` to `sessionStorage`).
 *
 * Pure/DOM-free by design (task's explicit unit-test requirement: "the
 * passenger-override state machine (5s countdown + session-remember) as
 * pure/testable logic") -- `driveLockStore.ts` is the only place real
 * timers/`Date.now()`/`sessionStorage` touch this.
 */
export interface PassengerOverrideState {
  /** Whether the override is currently active (lifts every non-Stop/Pause/Resume lock). */
  active: boolean;
  /** Epoch ms the countdown was (re)started at, or `null` while no countdown is running. */
  countdownStartedAt: number | null;
}

export const PASSENGER_COUNTDOWN_MS = 5_000;

export const INITIAL_PASSENGER_OVERRIDE_STATE: PassengerOverrideState = {
  active: false,
  countdownStartedAt: null,
};

/** Starts (or restarts) the 5-second countdown at `now`. A no-op on the
 *  `active` flag itself -- an already-active override starting a fresh
 *  countdown is harmless (it just never gets checked again while `active`). */
export function startPassengerCountdown(
  state: PassengerOverrideState,
  now: number,
): PassengerOverrideState {
  return { ...state, countdownStartedAt: now };
}

/** Cancels an in-progress countdown (e.g. the user closes the locked panel
 *  before the 5 s elapse) without touching `active`. */
export function cancelPassengerCountdown(state: PassengerOverrideState): PassengerOverrideState {
  return { ...state, countdownStartedAt: null };
}

/** Advances the state machine to `now`: once `PASSENGER_COUNTDOWN_MS` has
 *  elapsed since the countdown started, activates the override and clears
 *  the countdown. A no-op while no countdown is running or the override is
 *  already active. */
export function tickPassengerCountdown(
  state: PassengerOverrideState,
  now: number,
): PassengerOverrideState {
  if (state.active || state.countdownStartedAt === null) {
    return state;
  }
  if (now - state.countdownStartedAt >= PASSENGER_COUNTDOWN_MS) {
    return { active: true, countdownStartedAt: null };
  }
  return state;
}

/** Milliseconds remaining on an in-progress countdown, `null` if none is
 *  running. Clamped to `>= 0` (never negative, even if called slightly late). */
export function remainingCountdownMs(state: PassengerOverrideState, now: number): number | null {
  if (state.countdownStartedAt === null) {
    return null;
  }
  return Math.max(0, PASSENGER_COUNTDOWN_MS - (now - state.countdownStartedAt));
}
