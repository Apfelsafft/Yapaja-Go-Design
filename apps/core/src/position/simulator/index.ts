/**
 * GPS simulator position source (E02-T4). Docks onto PositionService
 * (E02-T1, see ../service.ts) exactly like any other source: it never
 * touches PositionService internals, it only calls `pushFix('simulator',
 * ...)`. Registration with the registry (`registerSource`) happens in
 * apps/core/src/index.ts alongside the other minimal-additive wiring.
 *
 * Responsibilities:
 *  - Build a `Track` (see track.ts) from a GPX fixture, inline GPX, or a
 *    polyline6 + speed profile.
 *  - Replay it as 1-simulated-Hz fixes (one fix per simulated second),
 *    scheduled in *wall clock* time at `1000 / speed_factor` ms per tick --
 *    `speed_factor` only changes how fast wall-clock catches up with the
 *    simulated timeline, never the computed speed/heading values
 *    themselves (docs/07-testing-qa.md §2).
 *  - Apply the four optional mutations: `noise_m` (per-tick, seeded),
 *    `outage` (skip pushFix during the window), `jump` (one-shot
 *    displacement), `detour` (rewrites the track itself at play() time,
 *    see track.ts#applyDetour).
 */

/* eslint-disable no-undef -- setTimeout/clearTimeout are standard Node
 * globals; see the identical rationale comment in ../service.ts. */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { Position } from '@yapaja/shared';
import type { PositionService, PositionSource } from '../service.js';
import { decodePolyline6 } from './polyline.js';
import { parseGpxTrackPoints } from './gpx.js';
import {
  buildTrackFromGpx,
  buildTrackFromPolyline,
  applyDetour,
  sampleTrack,
  type SpeedProfile,
  type Track,
} from './track.js';
import { applyGaussianNoise, applyJumpOffset, isWithinOutage, type SimulatorMutations } from './mutations.js';
import { mulberry32, type Rng } from './rng.js';
import type { LatLon } from './geo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '__fixtures__');

export const GPX_FIXTURE_IDS = ['city', 'country', 'tunnel'] as const;
export type GpxFixtureId = (typeof GPX_FIXTURE_IDS)[number];

export function isGpxFixtureId(value: unknown): value is GpxFixtureId {
  return typeof value === 'string' && (GPX_FIXTURE_IDS as readonly string[]).includes(value);
}

function loadFixtureGpx(id: GpxFixtureId): string {
  return readFileSync(join(FIXTURES_DIR, `${id}.gpx`), 'utf-8');
}

export interface PlayTrackGpxId {
  gpxId: GpxFixtureId;
}
export interface PlayTrackGpxInline {
  gpx: string;
}
export interface PlayTrackPolyline {
  polyline6: string;
  /** Constant average speed (m/s) applied to every segment. */
  speedMs?: number;
  /** Per-segment speed (m/s); length must equal (decoded points - 1). */
  speedsMs?: number[];
  /**
   * Klartext fuer den Status, wenn der Aufrufer mehr weiss als „polyline6".
   *
   * Eine abgefahrene Route soll im Status als solche erkennbar sein --
   * einschliesslich der Zahl der Abschnitte, fuer die kein Tempolimit
   * bekannt war und mit einem Ersatzwert gefahren wird (siehe
   * routeProfile.ts). Ohne diese Angabe saehe eine halb geratene Fahrt
   * genauso aus wie eine vollstaendig belegte.
   */
  description?: string;
}
export type PlayTrackInput = PlayTrackGpxId | PlayTrackGpxInline | PlayTrackPolyline;

export interface PlayOptions {
  track: PlayTrackInput;
  speed_factor?: number;
  mutations?: SimulatorMutations;
}

export type SimulatorPlaybackState = 'idle' | 'playing' | 'paused' | 'stopped';

export interface SimulatorStatus {
  state: SimulatorPlaybackState;
  trackDescription: string | null;
  /** Elapsed simulated seconds since the track started (monotonic within one play()). */
  tickS: number;
  totalDurationS: number | null;
  speedFactor: number;
  mutations: SimulatorMutations | null;
}

const MIN_SPEED_FACTOR = 0.1;
const MAX_SPEED_FACTOR = 100;
const DEFAULT_ACCURACY_M = 5;
const DEFAULT_SEED = 1;
const DEFAULT_DETOUR_DISTANCE_M = 300;

function clampSpeedFactor(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(MAX_SPEED_FACTOR, Math.max(MIN_SPEED_FACTOR, value));
}

function describeTrackInput(input: PlayTrackInput): string {
  if ('gpxId' in input) return `gpx:${input.gpxId}`;
  if ('gpx' in input) return 'gpx:inline';
  return input.description ?? 'polyline6';
}

function buildTrack(input: PlayTrackInput): Track {
  if ('polyline6' in input) {
    const waypoints = decodePolyline6(input.polyline6);
    if (waypoints.length < 2) {
      throw new Error('polyline6 must decode to at least 2 points');
    }
    if (!input.speedMs && !input.speedsMs) {
      throw new Error('polyline track requires a speed profile (speedMs or speedsMs)');
    }
    const profile: SpeedProfile = input.speedsMs
      ? { kind: 'list', speedsMs: input.speedsMs }
      : { kind: 'constant', speedMs: input.speedMs as number };
    return buildTrackFromPolyline(waypoints, profile);
  }

  const gpxXml = 'gpxId' in input ? loadFixtureGpx(input.gpxId) : input.gpx;
  const gpxPoints = parseGpxTrackPoints(gpxXml);
  return buildTrackFromGpx(gpxPoints);
}

/**
 * Simulator position source: replays a Track as 1-Hz-simulated `Position`
 * fixes into PositionService. One instance is created per server (see
 * apps/core/src/index.ts) and driven exclusively via play/pause/stop from
 * the REST control plane (./routes.ts).
 */
export class SimulatorSource implements PositionSource {
  readonly name = 'simulator' as const;

  private readonly positionService: PositionService;
  private state: SimulatorPlaybackState = 'idle';
  private track: Track | null = null;
  private trackDescription: string | null = null;
  private speedFactor = 1;
  private mutations: SimulatorMutations = {};
  private rng: Rng = mulberry32(DEFAULT_SEED);
  private jumpApplied = false;
  private tickS = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(positionService: PositionService) {
    this.positionService = positionService;
  }

  /** Starts (or restarts) playback of `opts.track` from t=0. */
  play(opts: PlayOptions): void {
    this.clearTimer();
    let track = buildTrack(opts.track);
    this.mutations = opts.mutations ?? {};
    if (this.mutations.detour) {
      track = applyDetour(track, this.mutations.detour.at_index, DEFAULT_DETOUR_DISTANCE_M);
    }
    this.track = track;
    this.trackDescription = describeTrackInput(opts.track);
    this.speedFactor = clampSpeedFactor(opts.speed_factor ?? 1);
    this.rng = mulberry32(this.mutations.seed ?? DEFAULT_SEED);
    this.jumpApplied = false;
    this.tickS = 0;
    this.state = 'playing';
    this.scheduleNextTick();
  }

  /** Resumes a paused playback in place (same track, tick position, mutations). No-op unless currently paused. */
  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.scheduleNextTick();
  }

  /**
   * Aendert den Zeitraffer waehrend der Wiedergabe.
   *
   * ─── WARUM DAS NICHT ueber play() GEHT ────────────────────────────────────
   * `play()` beginnt IMMER bei t=0. Wer also unterwegs von 2x auf 8x wollte,
   * haette die halbe Teststrecke noch einmal fahren muessen -- und genau das
   * soll der Zeitraffer ja ersparen. Gemeldet wurde „2x, 4x, 8x, 16x, 32x und
   * zurueck", also ein Regler waehrend der Fahrt, kein Startparameter.
   *
   * Der laufende Wecker wird sofort neu gestellt, damit die Aenderung nicht
   * erst nach der alten Wartezeit greift (von 1x auf 32x waere das eine ganze
   * Sekunde Verzoegerung -- spuerbar genug, um wie ein Fehler auszusehen).
   *
   * Die SIMULIERTE Zeit bleibt davon unberuehrt: `tickS` zaehlt nur in
   * `tick()` hoch. Der Zeitraffer aendert, wie schnell die Wanduhr aufholt,
   * nie die gefahrenen Werte selbst (docs/07 §2).
   *
   * @returns der tatsaechlich gesetzte Faktor (auf den erlaubten Bereich
   *          begrenzt) -- der Aufrufer soll anzeigen koennen, was wirklich
   *          gilt, statt was er angefragt hat.
   */
  setSpeedFactor(factor: number): number {
    this.speedFactor = clampSpeedFactor(factor);
    if (this.state === 'playing') {
      this.clearTimer();
      this.scheduleNextTick();
    }
    return this.speedFactor;
  }

  /** Suspends playback without losing position; resume() continues from here. No-op unless currently playing. */
  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.clearTimer();
  }

  /** Stops playback and discards the track. A subsequent play() is required to start again. */
  stop(): void {
    this.state = 'stopped';
    this.clearTimer();
    this.track = null;
    this.trackDescription = null;
    this.tickS = 0;
  }

  getStatus(): SimulatorStatus {
    return {
      state: this.state,
      trackDescription: this.trackDescription,
      tickS: this.tickS,
      totalDurationS: this.track?.totalDurationS ?? null,
      speedFactor: this.speedFactor,
      mutations: this.track ? this.mutations : null,
    };
  }

  /** Clears any pending timer. Call on server shutdown/test teardown -- see index.test.ts's leak checks. */
  dispose(): void {
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNextTick(): void {
    const wallDelayMs = 1000 / this.speedFactor;
    this.timer = setTimeout(() => this.tick(), wallDelayMs);
    this.timer.unref?.();
  }

  private tick(): void {
    // Timer may fire once more after stop()/pause() raced it (the pending
    // setTimeout was already armed before clearTimer() ran synchronously in
    // the same tick); bail out rather than pushing a stray fix.
    if (this.state !== 'playing' || !this.track) return;

    const t = this.tickS;
    const sample = sampleTrack(this.track, t);
    if (!sample) {
      this.state = 'stopped';
      return;
    }

    if (!isWithinOutage(t, this.mutations.outage)) {
      let point: LatLon = { lat: sample.lat, lon: sample.lon };

      const jump = this.mutations.jump;
      if (jump && !this.jumpApplied && t >= jump.at_s) {
        point = applyJumpOffset(point, sample.headingDeg, jump.offset_m);
        this.jumpApplied = true;
      }

      if (this.mutations.noise_m && this.mutations.noise_m > 0) {
        point = applyGaussianNoise(point, this.rng, this.mutations.noise_m);
      }

      const position: Position = {
        lat: point.lat,
        lon: point.lon,
        alt: sample.ele,
        speed: sample.speedMs,
        heading: sample.headingDeg,
        accuracy: DEFAULT_ACCURACY_M,
        source: 'simulator',
        fix: '3d',
        ts: new Date().toISOString(),
      };
      this.positionService.pushFix('simulator', position);
    }

    this.tickS += 1;
    this.scheduleNextTick();
  }
}

export { MIN_SPEED_FACTOR, MAX_SPEED_FACTOR };
