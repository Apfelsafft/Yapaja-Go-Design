/**
 * Pure recording state machine for the Track-Recorder (E09-T5, docs/05
 * §6.2). Deliberately has ZERO dependency on the add-on SDK, `fetch`, or
 * timers -- it's fed one `Position`-shaped fix at a time by `service.ts` and
 * returns a new state, so the actual "detect a GPS-loss gap -> start a new
 * `<trkseg>`" rule is fully unit-testable (`recorder.test.ts`) without a
 * running Core, a WebSocket, or a real clock.
 *
 * THE SEGMENT-SPLIT RULE: a new `<trkseg>` starts whenever the gap between
 * two consecutive ACCEPTED fixes' timestamps exceeds `GAP_THRESHOLD_MS`.
 * This is the whole point of splitting into segments in the first place
 * (docs/05 §6.2): a real GPS outage must never be drawn as a straight line
 * between the last fix before it and the first fix after it.
 */

export interface RecordedPoint {
  lat: number;
  lon: number;
  /** Altitude in meters, or `null` if the fix didn't report one. */
  ele: number | null;
  /** ISO 8601 UTC, taken verbatim from the `Position` fix (`ts`). */
  ts: string;
}

export interface RecorderState {
  recording: boolean;
  /** The id of the track currently being recorded (or most recently
   *  finished, until the next `start`), `null` before the first recording. */
  trackId: string | null;
  /** One array of points per `<trkseg>`. A fresh recording starts with an
   *  empty array (no segments yet -- the first accepted fix creates one). */
  segments: RecordedPoint[][];
  startedAt: string | null;
  /** Real (wall-clock) ms of the last ACCEPTED fix, used for gap detection.
   *  `null` before the first fix of the current recording. */
  lastFixAtMs: number | null;
  pointCount: number;
}

/** Gap (real elapsed ms between two consecutive fixes) beyond which the
 *  recorder treats the intervening time as a GPS outage and starts a new
 *  `<trkseg>` instead of connecting the two points. Chosen well above the
 *  Core's normal `pos/update` publish cadence (1 Hz default, i.e. ~1000 ms
 *  between fixes in steady state -- `apps/core/src/position/service.ts`'s
 *  `DEFAULT_RATE_HZ`), so ordinary publish jitter never triggers a false
 *  split, while a genuine multi-second signal loss reliably does. */
export const GAP_THRESHOLD_MS = 3000;

export function createRecorderState(): RecorderState {
  return {
    recording: false,
    trackId: null,
    segments: [],
    startedAt: null,
    lastFixAtMs: null,
    pointCount: 0,
  };
}

/** Begins a fresh recording (discarding any previous one's in-memory
 *  segments -- the caller is expected to have already persisted/exported the
 *  previous track via `service.ts` before calling this again). No-op (returns
 *  `state` unchanged) if already recording -- starting twice must not reset
 *  progress. */
export function startRecording(state: RecorderState, trackId: string, nowIso: string): RecorderState {
  if (state.recording) return state;
  return {
    recording: true,
    trackId,
    segments: [],
    startedAt: nowIso,
    lastFixAtMs: null,
    pointCount: 0,
  };
}

/** Ends the recording. The accumulated `segments`/`pointCount` are LEFT IN
 *  PLACE (not cleared) so the caller can still read them off to build the
 *  final GPX immediately after calling this. No-op if not recording. */
export function stopRecording(state: RecorderState): RecorderState {
  if (!state.recording) return state;
  return { ...state, recording: false };
}

/**
 * Feeds one fix into the state machine. A no-op (returns `state` unchanged)
 * when not currently recording -- `service.ts` still subscribes to
 * `pos/update` continuously regardless of recording state (simpler than
 * subscribing/unsubscribing per start/stop), so this guard is what actually
 * decides whether a fix counts.
 */
export function applyFix(
  state: RecorderState,
  fix: RecordedPoint,
  thresholdMs: number = GAP_THRESHOLD_MS,
): RecorderState {
  if (!state.recording) return state;

  const fixAtMs = Date.parse(fix.ts);
  const startsNewSegment = state.lastFixAtMs === null || fixAtMs - state.lastFixAtMs > thresholdMs;

  const segments = startsNewSegment
    ? [...state.segments, [fix]]
    : state.segments.map((seg, i) => (i === state.segments.length - 1 ? [...seg, fix] : seg));

  return {
    ...state,
    segments,
    lastFixAtMs: fixAtMs,
    pointCount: state.pointCount + 1,
  };
}
