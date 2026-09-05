/**
 * Fastify routes for GPS simulator control (E02-T4).
 * Prefix: /api/v1/simulator (see docs/07-testing-qa.md §2)
 *
 * Prod-guard: outside dev/test (NODE_ENV !== 'production' counts as
 * dev/test, matching EventBus's existing isProduction convention in
 * ../bus/index.ts), every route here 403s unless ENABLE_SIMULATOR=1 is set.
 * This is a live/staging safety net -- the simulator can force the active
 * position source and inject arbitrary fixes, which must never be reachable
 * on a real vehicle's core by accident.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { ApiError, Route } from '@yapaja/shared';
import type { PositionService } from '../service.js';
import {
  SimulatorSource,
  isGpxFixtureId,
  type PlayOptions,
  type PlayTrackInput,
} from './index.js';
import type { SimulatorMutations, OutageMutation, JumpMutation, DetourMutation } from './mutations.js';
import { routeSpeedProfile, FALLBACK_SPEED_KMH } from './routeProfile.js';

export interface SimulatorRoutesOptions {
  simulator: SimulatorSource;
  service: PositionService;
  /**
   * Zugriff auf den Routen-Zwischenspeicher -- ABSICHTLICH als Funktion.
   *
   * Dieses Plugin wird in `index.ts` registriert, BEVOR der RoutingService
   * gebaut ist. Ein direkt uebergebener Dienst waere zu diesem Zeitpunkt
   * `undefined`; die Registrierungen umzusortieren waere die groessere
   * Aenderung (Reihenfolge von Hooks und Routen) fuer den kleineren Gewinn.
   * Die Funktion wird erst beim Aufruf ausgewertet, dann steht alles.
   *
   * Fehlt sie, gibt es schlicht kein `track.routeId` -- alle anderen
   * Streckenarten funktionieren unveraendert.
   */
  getRoute?: (id: string) => Route | null;
}

function createErrorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ApiError {
  return {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}

function isSimulatorEnabled(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.ENABLE_SIMULATOR === '1';
}

// --- Request body parsing/validation -------------------------------------

interface RawPlayBody {
  track?: {
    gpxId?: unknown;
    gpx?: unknown;
    polyline6?: unknown;
    speedMs?: unknown;
    speedsMs?: unknown;
    routeId?: unknown;
    fallbackKmh?: unknown;
  };
  speed_factor?: unknown;
  mutations?: {
    noise_m?: unknown;
    seed?: unknown;
    outage?: { at_s?: unknown; duration_s?: unknown };
    jump?: { at_s?: unknown; offset_m?: unknown };
    detour?: { at_index?: unknown };
  };
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function parseTrack(
  raw: RawPlayBody['track'],
  getRoute?: (id: string) => Route | null,
): ParseResult<PlayTrackInput> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, message: 'track is required' };
  }
  // ─── EINE GEPLANTE ROUTE ABFAHREN ─────────────────────────────────────────
  // Gemeldet: „ein GPS-Simulator, der die gewaehlte Route dann zum Test
  // abfaehrt. Die jeweilige Fahrgeschwindigkeit sollte der entsprechenden
  // Hoechstgeschwindigkeit entsprechen."
  //
  // Aufgeloest wird HIER und nicht im Browser: die Zuordnung Streckenabschnitt
  // -> Tempolimit ist dieselbe Rechnung, die die Navigation schon macht
  // (`navigation/instructions.ts`). Zwei Rechnungen derselben Sache laufen
  // irgendwann auseinander -- siehe routeProfile.ts.
  if (raw.routeId !== undefined) {
    if (typeof raw.routeId !== 'string' || raw.routeId.length === 0) {
      return { ok: false, message: 'track.routeId must be a non-empty string' };
    }
    if (!getRoute) {
      return { ok: false, message: 'track.routeId is not available on this server' };
    }
    if (raw.fallbackKmh !== undefined && (!isFiniteNumber(raw.fallbackKmh) || raw.fallbackKmh <= 0)) {
      return { ok: false, message: 'track.fallbackKmh must be a positive number' };
    }
    const route = getRoute(raw.routeId);
    if (!route) {
      return { ok: false, message: `Route ${raw.routeId} ist nicht (mehr) bekannt` };
    }
    if (!route.geometry) {
      return { ok: false, message: `Route ${raw.routeId} hat keine Geometrie zum Abfahren` };
    }
    let profile;
    try {
      profile = routeSpeedProfile(route, (raw.fallbackKmh as number | undefined) ?? FALLBACK_SPEED_KMH);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Route nicht abfahrbar' };
    }
    return {
      ok: true,
      value: {
        polyline6: route.geometry,
        speedsMs: profile.speedsMs,
        // Ehrlich benannt: wie viele Abschnitte mit dem Ersatztempo gefahren
        // werden, statt mit einem echten Limit. Steht so im Status und ist
        // damit im Browser ablesbar -- ein still eingesetzter Wert waere hier
        // besonders heikel, weil die Fahrt danach „echt" aussieht.
        description: `route:${raw.routeId} (${profile.unknownSegments}/${profile.totalSegments} Abschnitte ohne Limit)`,
      },
    };
  }
  if (raw.gpxId !== undefined) {
    if (!isGpxFixtureId(raw.gpxId)) {
      return { ok: false, message: `track.gpxId must be one of the known fixture ids` };
    }
    return { ok: true, value: { gpxId: raw.gpxId } };
  }
  if (raw.gpx !== undefined) {
    if (typeof raw.gpx !== 'string' || raw.gpx.trim().length === 0) {
      return { ok: false, message: 'track.gpx must be a non-empty GPX XML string' };
    }
    return { ok: true, value: { gpx: raw.gpx } };
  }
  if (raw.polyline6 !== undefined) {
    if (typeof raw.polyline6 !== 'string' || raw.polyline6.length === 0) {
      return { ok: false, message: 'track.polyline6 must be a non-empty string' };
    }
    const speedMs = raw.speedMs;
    const speedsMs = raw.speedsMs;
    if (speedMs !== undefined && !isFiniteNumber(speedMs)) {
      return { ok: false, message: 'track.speedMs must be a number' };
    }
    if (speedsMs !== undefined && !(Array.isArray(speedsMs) && speedsMs.every(isFiniteNumber))) {
      return { ok: false, message: 'track.speedsMs must be an array of numbers' };
    }
    return {
      ok: true,
      value: {
        polyline6: raw.polyline6,
        speedMs: speedMs as number | undefined,
        speedsMs: speedsMs as number[] | undefined,
      },
    };
  }
  return { ok: false, message: 'track must specify one of gpxId, gpx, or polyline6' };
}

function parseMutations(raw: RawPlayBody['mutations']): ParseResult<SimulatorMutations | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, message: 'mutations must be an object' };
  }

  const mutations: SimulatorMutations = {};

  if (raw.noise_m !== undefined) {
    if (!isFiniteNumber(raw.noise_m) || raw.noise_m < 0) {
      return { ok: false, message: 'mutations.noise_m must be a non-negative number' };
    }
    mutations.noise_m = raw.noise_m;
  }

  if (raw.seed !== undefined) {
    if (!isFiniteNumber(raw.seed)) {
      return { ok: false, message: 'mutations.seed must be a number' };
    }
    mutations.seed = raw.seed;
  }

  if (raw.outage !== undefined) {
    const o = raw.outage;
    if (!o || !isFiniteNumber(o.at_s) || !isFiniteNumber(o.duration_s) || o.duration_s <= 0) {
      return { ok: false, message: 'mutations.outage requires numeric at_s and positive duration_s' };
    }
    mutations.outage = { at_s: o.at_s, duration_s: o.duration_s } satisfies OutageMutation;
  }

  if (raw.jump !== undefined) {
    const j = raw.jump;
    if (!j || !isFiniteNumber(j.at_s) || !isFiniteNumber(j.offset_m)) {
      return { ok: false, message: 'mutations.jump requires numeric at_s and offset_m' };
    }
    mutations.jump = { at_s: j.at_s, offset_m: j.offset_m } satisfies JumpMutation;
  }

  if (raw.detour !== undefined) {
    const d = raw.detour;
    if (!d || !isFiniteNumber(d.at_index) || d.at_index < 0) {
      return { ok: false, message: 'mutations.detour requires a non-negative numeric at_index' };
    }
    mutations.detour = { at_index: d.at_index } satisfies DetourMutation;
  }

  return { ok: true, value: mutations };
}

function parsePlayBody(
  body: unknown,
  getRoute?: (id: string) => Route | null,
): ParseResult<PlayOptions> {
  if (!body || typeof body !== 'object') {
    return { ok: false, message: 'Invalid request body' };
  }
  const raw = body as RawPlayBody;

  const trackResult = parseTrack(raw.track, getRoute);
  if (!trackResult.ok) return trackResult;

  if (raw.speed_factor !== undefined && (!isFiniteNumber(raw.speed_factor) || raw.speed_factor <= 0)) {
    return { ok: false, message: 'speed_factor must be a positive number' };
  }

  const mutationsResult = parseMutations(raw.mutations);
  if (!mutationsResult.ok) return mutationsResult;

  return {
    ok: true,
    value: {
      track: trackResult.value,
      speed_factor: raw.speed_factor as number | undefined,
      mutations: mutationsResult.value,
    },
  };
}

export const simulatorPlugin: FastifyPluginAsync<SimulatorRoutesOptions> = async (fastify, opts) => {
  const { simulator, service } = opts;

  fastify.addHook('onRequest', async (_request, reply) => {
    if (!isSimulatorEnabled()) {
      return reply
        .code(403)
        .send(
          createErrorResponse(
            'SIMULATOR_DISABLED',
            'GPS simulator control is disabled in production unless ENABLE_SIMULATOR=1 is set',
          ),
        );
    }
  });

  // POST /simulator/play - start (or, with an empty body while paused, resume) playback.
  fastify.post<{ Body: unknown; Reply: { data: ReturnType<SimulatorSource['getStatus']> } | ApiError }>(
    '/simulator/play',
    async (request, reply) => {
      const body = request.body ?? {};
      const hasTrack = typeof body === 'object' && body !== null && 'track' in body;

      if (!hasTrack) {
        const status = simulator.getStatus();
        if (status.state !== 'paused') {
          return reply
            .code(400)
            .send(createErrorResponse('VALIDATION_ERROR', 'track is required to start playback'));
        }
        simulator.resume();
        service.setForcedSource('simulator');
        return reply.code(200).send({ data: simulator.getStatus() });
      }

      const parsed = parsePlayBody(body, opts.getRoute);
      if (!parsed.ok) {
        return reply.code(400).send(createErrorResponse('VALIDATION_ERROR', parsed.message));
      }

      try {
        simulator.play(parsed.value);
      } catch (err) {
        return reply
          .code(400)
          .send(
            createErrorResponse(
              'VALIDATION_ERROR',
              err instanceof Error ? err.message : 'Failed to start simulator playback',
            ),
          );
      }

      // Per docs/07-testing-qa.md §2: playing the simulator forces it as the
      // active position source, so its fixes actually reach pos/update.
      service.setForcedSource('simulator');
      return reply.code(200).send({ data: simulator.getStatus() });
    },
  );

  // POST /simulator/speed - Zeitraffer WAEHREND der Wiedergabe aendern.
  //
  // Eigener Endpunkt und kein Feld an `play`: `play` beginnt immer bei t=0.
  // Gemeldet wurde „2x, 4x, 8x, 16x, 32x und zurueck" -- ein Regler unterwegs,
  // kein Startparameter. Ueber `play` haette jeder Stufenwechsel die
  // Teststrecke von vorn begonnen, also genau die Zeit gekostet, die der
  // Zeitraffer sparen soll.
  fastify.post<{ Body: unknown }>('/simulator/speed', async (request, reply) => {
    const body = request.body;
    const raw = (body && typeof body === 'object' ? body : {}) as { speed_factor?: unknown };
    if (!isFiniteNumber(raw.speed_factor) || raw.speed_factor <= 0) {
      return reply
        .code(400)
        .send(createErrorResponse('VALIDATION_ERROR', 'speed_factor must be a positive number'));
    }
    simulator.setSpeedFactor(raw.speed_factor);
    // Der Status meldet den TATSAECHLICH gesetzten Faktor (auf den erlaubten
    // Bereich begrenzt), nicht den angefragten -- sonst zeigte die Oberflaeche
    // eine Stufe an, die gar nicht laeuft.
    return reply.code(200).send({ data: simulator.getStatus() });
  });

  // POST /simulator/pause
  fastify.post('/simulator/pause', async (_request, reply) => {
    simulator.pause();
    return reply.code(200).send({ data: simulator.getStatus() });
  });

  // POST /simulator/stop
  fastify.post('/simulator/stop', async (_request, reply) => {
    simulator.stop();
    return reply.code(200).send({ data: simulator.getStatus() });
  });

  // GET /simulator/status
  fastify.get('/simulator/status', async (_request, reply) => {
    return reply.code(200).send({
      data: {
        ...simulator.getStatus(),
        activeSource: service.getActiveSource(),
        forcedSource: service.getForcedSource(),
      },
    });
  });
};
