/**
 * Track-Recorder (E09-T5, docs/05 §6.2) -- SERVICE entry point (Type B,
 * `service.entry`). Runs as a Core-spawned Node child process
 * (`apps/core/src/addons/service-host.ts`) and talks to the Core EXCLUSIVELY
 * through `@yapaja/addon-sdk`'s `connectAddon()` -- no raw `fetch`, no raw
 * `WebSocket`, no internal imports (docs/05 §1B). Verified by
 * `addons-examples/no-raw-transport.test.ts`.
 *
 * Responsibilities:
 *  - Subscribe to `pos/update` (`pos.read`) for as long as the process runs,
 *    feeding every fix into the pure `recorder.ts` state machine, which is
 *    what actually implements the GPS-loss segment-split rule.
 *  - Poll a `storage.own` "command" key (written by `ui.ts` from the OTHER
 *    transport) so the UI can start/stop a recording. `storage.own` is the
 *    ONLY channel available for UI<->service communication today: the SDK
 *    has no `events.subscribe` on the UI/postMessage transport (only
 *    `events.publish`, see `packages/addon-sdk/src/types.ts`), and the UI
 *    iframe's CSP forbids `fetch`/WS entirely -- see this add-on's README
 *    and this task's final report for the full reasoning.
 *  - Publish a live "state" snapshot (recording?/elapsed/distance/point
 *    count) to `storage.own` so the UI can poll+display it.
 *  - On stop, serialize the finished recording to GPX (`gpx.ts`) and persist
 *    both the GPX text and an updated track index, all under `storage.own`.
 *  - E09-T8: ALSO publish lightweight `started`/`stopped` notification
 *    events via `events.publish` (-> `addon/{id}/started|stopped` on the
 *    bus, -> `yapaja/addon/{id}/started|stopped` over MQTT/HA). This is a
 *    SEPARATE, narrower purpose from the `storage.own` channel above: see
 *    the README's "`events.publish` (E09-T8): external status notifications,
 *    not the UI<->service channel" section for why both coexist without
 *    contradiction -- short version, `storage.own` is still the only
 *    UI<->service channel (unchanged, still true, still the only viable one
 *    for the reasons documented there); `events.publish` here is a
 *    fire-and-forget, external (HA-facing) notification that the UI never
 *    consumes at all.
 */

import { connectAddon } from '@yapaja/addon-sdk';
import { createRecorderState, startRecording, stopRecording, applyFix, type RecorderState } from './recorder.js';
import { buildGpx } from './gpx.js';
import { totalDistanceMeters } from './distance.js';

const COMMAND_POLL_MS = 500;

interface RecorderCommand {
  action: 'start' | 'stop';
  /** Monotonic-ish (wall-clock `Date.now()`) so a UI reload never replays an
   *  already-handled command -- see the README's "why storage.own, not
   *  events" section. */
  seq: number;
}

interface TrackSummary {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string;
  distanceMeters: number;
  pointCount: number;
  segmentCount: number;
}

/**
 * The SERVICE transport's raw `position.subscribe` payload is the Core's
 * FULL `Position` shape (`@yapaja/shared`), including `lon` (NOT `lng`) and
 * a real `ts` -- see docs/addon-dev-guide.md's "position.subscribe payload
 * shape differs by transport" note (added while building this reference
 * add-on) and `apps/core/src/position/service.ts`'s
 * `bus.publish('pos/update', position)`. The SDK's `PositionUpdate` type is
 * the narrower postMessage-transport shape (`{lat, lng}`); it happens to
 * have an index signature, so TypeScript doesn't stop `.lon`/`.ts` access,
 * but `.lng` would be `undefined` here. This local type documents the ACTUAL
 * runtime shape this file relies on.
 */
interface ServiceTransportPositionFix {
  lat: number;
  lon: number;
  alt: number | null;
  ts: string;
}

function isServiceTransportPositionFix(value: unknown): value is ServiceTransportPositionFix {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.lat === 'number' && typeof v.lon === 'number' && typeof v.ts === 'string';
}

async function main(): Promise<void> {
  const addon = await connectAddon();

  let state: RecorderState = createRecorderState();
  let lastHandledSeq = 0;

  async function publishState(): Promise<void> {
    await addon.storage.set('state', {
      recording: state.recording,
      trackId: state.trackId,
      startedAt: state.startedAt,
      pointCount: state.pointCount,
      distanceMeters: totalDistanceMeters(state.segments),
      segmentCount: state.segments.filter((s) => s.length > 0).length,
    });
  }

  /** Persists the GPX + index entry (`storage.own`, unchanged from before
   *  E09-T8) and RETURNS the summary so the caller can also attach it to the
   *  `events.publish` "stopped" notification -- one computation, two
   *  consumers, never out of sync with each other. */
  async function finalizeTrack(): Promise<TrackSummary | null> {
    if (!state.trackId) return null;
    const gpx = buildGpx({ trackName: state.trackId, segments: state.segments });
    await addon.storage.set(`track:${state.trackId}`, gpx);

    const existingIndex = await addon.storage.get<TrackSummary[]>('index');
    const index = Array.isArray(existingIndex) ? existingIndex : [];
    const summary: TrackSummary = {
      id: state.trackId,
      name: state.trackId,
      startedAt: state.startedAt ?? '',
      endedAt: new Date().toISOString(),
      distanceMeters: totalDistanceMeters(state.segments),
      pointCount: state.pointCount,
      segmentCount: state.segments.filter((s) => s.length > 0).length,
    };
    await addon.storage.set('index', [...index, summary]);
    return summary;
  }

  async function pollCommand(): Promise<void> {
    let command: RecorderCommand | undefined;
    try {
      command = await addon.storage.get<RecorderCommand>('command');
    } catch (err) {
      console.error('[track-recorder] storage.get(command) failed', err instanceof Error ? err.message : err);
      return;
    }
    if (!command || typeof command.seq !== 'number' || command.seq <= lastHandledSeq) return;
    lastHandledSeq = command.seq;

    if (command.action === 'start' && !state.recording) {
      const trackId = `track-${Date.now()}`;
      state = startRecording(state, trackId, new Date().toISOString());
      await publishState();
      // E09-T8: HA-facing notification, e.g. an automation that announces
      // "Aufzeichnung gestartet" or flips a helper on. See
      // docs/04-home-assistant.md §6 for a worked automation using this
      // exact event.
      await publishAddonEvent('started', { trackId, startedAt: state.startedAt });
    } else if (command.action === 'stop' && state.recording) {
      state = stopRecording(state);
      const summary = await finalizeTrack();
      await publishState();
      if (summary) await publishAddonEvent('stopped', summary);
    }
  }

  /** `events.publish` never throws out of this add-on's own control flow --
   *  a missing/denied scope (`ScopeDeniedError`) or a transient network
   *  hiccup must never crash the recorder itself, since the GPX/`storage.own`
   *  side (the primary job) already succeeded by the time this runs. */
  async function publishAddonEvent(topic: string, payload: unknown): Promise<void> {
    try {
      await addon.events.publish(topic, payload);
    } catch (err) {
      console.error(`[track-recorder] events.publish("${topic}") failed`, err instanceof Error ? err.message : err);
    }
  }

  addon.position.subscribe(
    (rawFix) => {
      if (!state.recording) return;
      if (!isServiceTransportPositionFix(rawFix)) return;
      state = applyFix(state, { lat: rawFix.lat, lon: rawFix.lon, ele: rawFix.alt, ts: rawFix.ts });
      void publishState();
    },
    (err) => {
      console.error('[track-recorder] position.subscribe rejected', err.message);
    },
  );

  await publishState();
  setInterval(() => {
    void pollCommand();
  }, COMMAND_POLL_MS);
}

void main();
