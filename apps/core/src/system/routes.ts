/**
 * Fastify routes for system state (E08-T5, W-12/W-18; erweitert in
 * `feat/gui-install-path`). Prefix: /api/v1.
 *
 *  - GET /api/v1/system/resources -> `{ data: SystemResources }`, real
 *    measured free/total disk (of the map-tiles data dir) + free/total RAM.
 *  - GET /api/v1/system/preflight -> `{ data: PreflightReport }`, die
 *    Installationsprüfung: was fehlt, wie schlimm, und was zu tun ist
 *    (siehe `preflight.ts`).
 *
 * `resources` is consumed by the onboarding wizard's region step to derive a
 * "< 3 GB free -> recommend turning Photon off" recommendation client-side
 * (see `apps/web/src/onboarding/resourceRecommendation.ts`) -- that endpoint
 * only reports the raw numbers, it never hardcodes or embeds the
 * recommendation itself.
 *
 * `preflight` is the opposite by design: it DOES judge, because its whole
 * purpose is to tell an operator who never opens a shell what to do next.
 * It is deliberately more expensive than `/api/v1/health` (it opens TCP
 * connections and reads the filesystem) and is therefore called on demand
 * from the GUI, never as a watchdog probe.
 */

import type { FastifyPluginAsync } from 'fastify';
import { resolveTilesDir } from '../map/paths.js';
import { getSystemResources, type FullStatfsFn, type SystemResources } from './resources.js';
import { runPreflight, type PreflightDeps, type PreflightReport } from './preflight.js';
import type { ApiError } from '@yapaia/shared';

/** Wie in `settings/routes.ts` -- dieselbe Fehlerhuelle, lokal gehalten. */
function createErrorResponse(code: string, message: string): ApiError {
  return { error: { code, message } };
}

export interface SystemPluginOptions {
  /** Defaults to the map tiles dir (`TILES_DIR`/`resolveTilesDir()`) -- the
   *  filesystem that actually matters for "can a region download fit". */
  dataDir?: string;
  /** Injectable for tests; defaults to the real `fs.statfs`. */
  statfsFn?: FullStatfsFn;
  /** Injectable for tests; defaults to the real `os.freemem`. */
  freeMemFn?: () => number;
  /** Injectable for tests; defaults to the real `os.totalmem`. */
  totalMemFn?: () => number;
  /** Injectable probes for the preflight check (see `preflight.ts`).
   *  Defaults to the real filesystem/network probes. */
  preflightDeps?: PreflightDeps;
  /**
   * Woher die Liste der `device_tracker` kommt und wie der gewaehlte
   * gespeichert wird (B-05, Companion App). Fehlt sie, antwortet die Route
   * mit einer leeren Liste statt zu scheitern -- eine Einrichtungshilfe darf
   * nichts blockieren.
   */
  trackerDeps?: TrackerDeps;
}

export interface TrackerDeps {
  /** Alle `device_tracker.*` MIT Koordinaten, wie sie Home Assistant kennt. */
  listeTracker: () => Promise<Array<{ entity_id: string; friendly_name: string }>>;
  /** Die aktuell gewaehlte Entity-ID (Einstellung oder Add-on-Option). */
  gewaehlt: () => string;
  /** Speichert die Wahl. Leerer Text = wieder abwaehlen. */
  waehle: (entityId: string) => void;
}

interface SystemResourcesReply {
  data: SystemResources;
}

interface PreflightReply {
  data: PreflightReport;
}

export const systemPlugin: FastifyPluginAsync<SystemPluginOptions> = async (fastify, opts) => {
  const dataDir = opts.dataDir ?? resolveTilesDir();

  fastify.get<{ Reply: SystemResourcesReply }>('/api/v1/system/resources', async (_request, reply) => {
    const data = await getSystemResources(dataDir, {
      statfsFn: opts.statfsFn,
      freeMemFn: opts.freeMemFn,
      totalMemFn: opts.totalMemFn,
    });
    reply.code(200).send({ data });
  });

  // Antwortet IMMER 200, auch wenn die Installation unvollständig ist. Der
  // Zustand steht im Rumpf (`data.status`), nicht im HTTP-Status: ein 503
  // hier würde bedeuten, dass generische Fehlerbehandlung im Client (oder
  // ein Reverse Proxy) genau die Seite verschluckt, die erklärt, was fehlt.
  fastify.get<{ Reply: PreflightReply }>('/api/v1/system/preflight', async (_request, reply) => {
    const data = await runPreflight(opts.preflightDeps);
    reply.code(200).send({ data });
  });

  // ─── DIE POSITIONSQUELLE AUS DER COMPANION APP AUSWAEHLEN ────────────────
  // Bis 0.7.0 musste hier eine Entity-ID von Hand in die Add-on-Konfiguration
  // getippt werden -- eine Angabe, die man nicht weiss, sondern in Home
  // Assistant unter Entwicklerwerkzeuge -> Zustaende nachschlagen muss. Eine
  // Einrichtung, die aus einem Textfeld und einem Ratespiel besteht, ist
  // keine. Diese Route liefert die Auswahl, die es wirklich gibt.
  fastify.get<{ Reply: { data: { trackers: Array<{ entity_id: string; friendly_name: string }>; selected: string } } }>(
    '/api/v1/system/ha/trackers',
    async (_request, reply) => {
      const deps = opts.trackerDeps;
      if (!deps) {
        reply.code(200).send({ data: { trackers: [], selected: '' } });
        return;
      }
      reply.code(200).send({ data: { trackers: await deps.listeTracker(), selected: deps.gewaehlt() } });
    },
  );

  fastify.post<{ Body: { entity_id?: unknown }; Reply: { data: { selected: string } } | ApiError }>(
    '/api/v1/system/ha/trackers',
    async (request, reply) => {
      const deps = opts.trackerDeps;
      const roh = request.body?.entity_id;
      if (roh !== undefined && typeof roh !== 'string') {
        return reply
          .code(400)
          .send(createErrorResponse('VALIDATION_ERROR', 'entity_id muss ein Text sein'));
      }
      const gewuenscht = (roh ?? '').trim();
      // Leer ist gueltig: „doch keinen" muss genauso gehen wie „diesen".
      if (gewuenscht.length > 0 && !gewuenscht.startsWith('device_tracker.')) {
        return reply
          .code(400)
          .send(
            createErrorResponse(
              'VALIDATION_ERROR',
              'entity_id muss eine device_tracker-Entitaet sein',
            ),
          );
      }
      deps?.waehle(gewuenscht);
      reply.code(200).send({ data: { selected: gewuenscht } });
    },
  );
};
