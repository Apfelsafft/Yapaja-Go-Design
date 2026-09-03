/**
 * Region-manager routes (E01-T5, docs/03-api-spec.md §2 "Karten & Tiles"):
 *
 * - GET    /api/v1/map/regions/catalog   downloadable regions + `installed` flag
 * - POST   /api/v1/map/regions           starts a resumable download job (202)
 * - POST   /api/v1/map/regions/:id/build starts a tile BUILD job (202, B-04)
 * - DELETE /api/v1/map/regions/:id       removes an installed region (409 if last)
 * - GET    /api/v1/jobs/:id              job status (progress/bytes/error)
 * - DELETE /api/v1/jobs/:id              cancels a queued/running job
 *
 * `GET /api/v1/map/regions` (listing installed regions) already lives in
 * `../routes.ts` (E01-T1) and is untouched -- this plugin is registered
 * alongside it by `mapPlugin`, purely additive.
 */

import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import type { FastifyPluginAsync } from 'fastify';
import type { ApiError } from '@yapaja/shared';
import { REGION_NAME_PATTERN, resolveRegionFilePath, resolveTilesDir } from '../paths.js';
import { listRegions } from '../regions.js';
import { loadCatalog, type CatalogEntry } from './catalog.js';
import { checkDiskSpace, type StatfsFn } from './disk.js';
import { computeRemainingBytes, existingPartBytes, finalFilePath, partFilePath, runDownloadJob } from './download.js';
import {
  BUILD_JOB_KIND,
  GRAPH_BUILD,
  LITE_INDEX_BUILD,
  buildRequiredBytes,
  buildRequiredFreeMemory,
  defaultFreeMem,
  runBuildJob,
  type BuildJobDeps,
} from './build.js';
import { JobRegistry, type JobSnapshot } from './jobs.js';

export interface RegionsPluginOptions {
  /** Injectable for tests (simulates a near-full disk); defaults to the
   *  real `fs.statfs`. */
  statfsImpl?: StatfsFn;
  /** Injectable for tests: Prozess-Start und freier RAM des Kachelbaus. */
  buildDeps?: BuildJobDeps;
}

interface CatalogReplyEntry extends CatalogEntry {
  installed: boolean;
}

interface CatalogReply {
  data: CatalogReplyEntry[];
}

interface PostRegionsBody {
  region_id?: string;
}

interface PostRegionsReply {
  job_id: string;
}

interface JobReply {
  data: JobSnapshot;
}

interface IdParams {
  id: string;
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

export const regionsPlugin: FastifyPluginAsync<RegionsPluginOptions> = async (fastify, opts) => {
  const tilesDir = resolveTilesDir();
  const jobs = new JobRegistry();
  const statfsImpl = opts.statfsImpl;

  // GET /api/v1/map/regions/catalog -- downloadable regions + installed flag.
  fastify.get<{ Reply: CatalogReply | ApiError }>(
    '/api/v1/map/regions/catalog',
    async (_request, reply) => {
      let catalog: CatalogEntry[];
      try {
        catalog = await loadCatalog();
      } catch (err) {
        fastify.log.error({ error: (err as Error).message }, 'Failed to load regions catalog');
        return reply
          .code(500)
          .send(createErrorResponse('CATALOG_UNAVAILABLE', 'Regions catalog could not be loaded'));
      }
      const installedRegions = await listRegions(tilesDir, fastify.log);
      const installedIds = new Set(installedRegions.map((r) => r.region));
      const data = catalog.map((entry) => ({ ...entry, installed: installedIds.has(entry.id) }));
      return reply.code(200).send({ data });
    },
  );

  // POST /api/v1/map/regions -- starts a resumable download job (W-17).
  fastify.post<{ Body: PostRegionsBody; Reply: PostRegionsReply | ApiError }>(
    '/api/v1/map/regions',
    async (request, reply) => {
      const regionId = request.body?.region_id;
      if (!regionId || typeof regionId !== 'string' || !REGION_NAME_PATTERN.test(regionId)) {
        return reply
          .code(400)
          .send(createErrorResponse('INVALID_REGION', 'region_id is required and must be a valid region slug'));
      }

      let catalog: CatalogEntry[];
      try {
        catalog = await loadCatalog();
      } catch (err) {
        fastify.log.error({ error: (err as Error).message }, 'Failed to load regions catalog');
        return reply
          .code(500)
          .send(createErrorResponse('CATALOG_UNAVAILABLE', 'Regions catalog could not be loaded'));
      }

      const entry = catalog.find((candidate) => candidate.id === regionId);
      if (!entry) {
        return reply
          .code(404)
          .send(createErrorResponse('NOT_FOUND', `Unknown catalog region '${regionId}'`));
      }

      const finalPath = finalFilePath(tilesDir, regionId);
      if (existsSync(finalPath)) {
        return reply
          .code(409)
          .send(createErrorResponse('ALREADY_INSTALLED', `Region '${regionId}' is already installed`));
      }

      // Resume-aware: only the bytes still missing need to fit, not the
      // full catalog size, so retrying an interrupted download doesn't get
      // needlessly rejected once most of it is already on disk.
      const resumeFrom = await existingPartBytes(partFilePath(tilesDir, regionId));
      const remainingBytes = computeRemainingBytes(entry.sizeBytes, resumeFrom);

      const diskCheck = await checkDiskSpace(tilesDir, remainingBytes, statfsImpl);
      if (!diskCheck.ok) {
        return reply.code(409).send(
          createErrorResponse(
            'INSUFFICIENT_SPACE',
            'Not enough free disk space to download this region',
            { requiredBytes: diskCheck.requiredBytes, freeBytes: diskCheck.freeBytes },
          ),
        );
      }

      const jobId = jobs.create();
      runDownloadJob(jobId, jobs, entry, tilesDir);
      return reply.code(202).send({ job_id: jobId });
    },
  );

  // POST /api/v1/map/regions/:id/build -- baut die Kacheln aus dem
  // OSM-Extrakt (B-04). Der Gegenpart zum Download fuer Regionen, fuer die
  // es keine fertige Datei gibt -- also fuer alle mitgelieferten.
  //
  // Die beiden Vorpruefungen sind kein Zierrat: ein Bau, der nach zwei
  // Stunden an vollem Speicher scheitert, hat zwei Stunden gekostet, und
  // ein OOM auf einer HAOS-VM trifft nicht unbedingt planetiler, sondern
  // Home Assistant. Beide Ablehnungen nennen deshalb die konkreten Zahlen.
  fastify.post<{ Params: IdParams; Reply: PostRegionsReply | ApiError }>(
    '/api/v1/map/regions/:id/build',
    async (request, reply) => {
      const regionId = request.params.id;
      if (!REGION_NAME_PATTERN.test(regionId)) {
        return reply
          .code(400)
          .send(createErrorResponse('INVALID_REGION', 'id must be a valid region slug'));
      }

      let catalog: CatalogEntry[];
      try {
        catalog = await loadCatalog();
      } catch (err) {
        fastify.log.error({ error: (err as Error).message }, 'Failed to load regions catalog');
        return reply
          .code(500)
          .send(createErrorResponse('CATALOG_UNAVAILABLE', 'Regions catalog could not be loaded'));
      }

      const entry = catalog.find((candidate) => candidate.id === regionId);
      if (!entry) {
        return reply
          .code(404)
          .send(createErrorResponse('NOT_FOUND', `Unknown catalog region '${regionId}'`));
      }

      if (!entry.pbfUrl) {
        return reply
          .code(409)
          .send(
            createErrorResponse(
              'NO_BUILD_SOURCE',
              `Für die Region '${regionId}' ist kein OSM-Extrakt hinterlegt (pbfUrl).`,
            ),
          );
      }

      if (existsSync(finalFilePath(tilesDir, regionId))) {
        return reply
          .code(409)
          .send(createErrorResponse('ALREADY_INSTALLED', `Region '${regionId}' is already installed`));
      }

      // ZWEI KACHELBAUTEN GLEICHZEITIG ZERSTOEREN EINANDER.
      //
      // Beide planetiler-Prozesse benutzen DASSELBE Verzeichnis fuer die
      // gemeinsamen Basisdaten (Wasserflaechen, Natural Earth,
      // Seen-Mittellinien). Der zweite Lauf liest dann eine Datei, die der
      // erste noch herunterlaedt, und stirbt an:
      //
      //   java.util.zip.ZipException: zip END header not found
      //
      // Das sieht aus wie ein kaputter Download und ist in Wahrheit ein
      // Wettlauf. Genau so ist es im Betrieb passiert: der Knopf wurde ein
      // zweites Mal gedrueckt, waehrend der erste Lauf noch bei 66 % des
      // Wasserflaechen-Downloads stand. Im Protokoll standen daraufhin zwei
      // Laufzeituhren nebeneinander (0:03:17 und 0:01:52) -- der einzige
      // sichtbare Hinweis darauf, dass es zwei Prozesse waren.
      //
      // Die Sperre gilt bewusst UEBER ALLE REGIONEN, nicht je Region: geteilt
      // ist das Quellenverzeichnis, nicht die Region.
      const running = jobs.findUnfinished(BUILD_JOB_KIND);
      if (running) {
        return reply.code(409).send(
          createErrorResponse(
            'BUILD_IN_PROGRESS',
            'Es läuft bereits ein Kachelbau. Zwei Bauten gleichzeitig sind nicht ' +
              'möglich, weil beide dieselben Basisdaten verwenden — der zweite würde ' +
              'auf halb geladene Dateien treffen. Warten Sie das Ende ab oder brechen ' +
              'Sie den laufenden Bau ab.',
            { jobId: running.id },
          ),
        );
      }

      const requiredBytes = buildRequiredBytes(entry);
      const diskCheck = await checkDiskSpace(tilesDir, requiredBytes, statfsImpl);
      if (!diskCheck.ok) {
        return reply.code(409).send(
          createErrorResponse(
            'INSUFFICIENT_SPACE',
            'Nicht genug freier Speicherplatz für den Kachelbau. Der Bau braucht neben ' +
              'der fertigen Datei auch Platz für das Zwischenergebnis.',
            { requiredBytes: diskCheck.requiredBytes, freeBytes: diskCheck.freeBytes },
          ),
        );
      }

      const freeMemFn = opts.buildDeps?.freeMemFn ?? defaultFreeMem;
      const requiredMemory = buildRequiredFreeMemory();
      const freeMemory = freeMemFn();
      if (freeMemory < requiredMemory) {
        return reply.code(409).send(
          createErrorResponse(
            'INSUFFICIENT_MEMORY',
            'Zu wenig freier Arbeitsspeicher für den Kachelbau. Schalten Sie Photon in ' +
              'der Add-on-Konfiguration ab („photon_enabled: false") und versuchen Sie es ' +
              'erneut — das ist auf einem Gerät mit 8 GB ohnehin die empfohlene ' +
              'Einstellung (W-12).',
            { requiredBytes: requiredMemory, freeBytes: freeMemory },
          ),
        );
      }

      const jobId = jobs.create(BUILD_JOB_KIND);
      // Der Logger wird hier verdrahtet, nicht in `build.ts`: nur die Route
      // kennt die Fastify-Instanz, und deren stdout ist das, was im
      // Add-on-Protokoll erscheint.
      runBuildJob(jobId, jobs, entry, tilesDir, {
        ...opts.buildDeps,
        logger: opts.buildDeps?.logger ?? ((line) => fastify.log.info(line)),
      });
      return reply.code(202).send({ job_id: jobId });
    },
  );

  // POST /api/v1/map/regions/:id/build-graph -- baut den ROUTINGGRAPHEN aus
  // demselben OSM-Extrakt.
  //
  // Bis 2026-09-03 hiess es, das ginge auf dem Geraet nicht: das Werkzeug
  // brauche einen Docker-Socket. Das galt fuer unser SKRIPT
  // (`services/valhalla/build-tiles.sh` faehrt ein Image von aussen an),
  // nicht fuer die WERKZEUGE -- dieses Add-on setzt mit `FROM` auf genau
  // jenem Image auf, dessen Dockerfile `valhalla_build_tiles` und
  // Geschwister ausdruecklich aufbewahrt. Dieselbe Fehlerklasse wie beim
  // JAR-Modus von planetiler: der Weg war da, das Skript fand ihn nicht --
  // und die Oberflaeche schickte den Betreiber an einen zweiten Rechner,
  // den es nicht braucht.
  fastify.post<{ Params: IdParams; Reply: PostRegionsReply | ApiError }>(
    '/api/v1/map/regions/:id/build-graph',
    async (request, reply) => {
      const regionId = request.params.id;
      if (!REGION_NAME_PATTERN.test(regionId)) {
        return reply
          .code(400)
          .send(createErrorResponse('INVALID_REGION', 'id must be a valid region slug'));
      }

      let catalog: CatalogEntry[];
      try {
        catalog = await loadCatalog();
      } catch (err) {
        fastify.log.error({ error: (err as Error).message }, 'Failed to load regions catalog');
        return reply
          .code(500)
          .send(createErrorResponse('CATALOG_UNAVAILABLE', 'Regions catalog could not be loaded'));
      }

      const entry = catalog.find((candidate) => candidate.id === regionId);
      if (!entry) {
        return reply
          .code(404)
          .send(createErrorResponse('NOT_FOUND', `Unknown catalog region '${regionId}'`));
      }

      if (!entry.pbfUrl) {
        return reply
          .code(409)
          .send(
            createErrorResponse(
              'NO_BUILD_SOURCE',
              `Für die Region '${regionId}' ist kein OSM-Extrakt hinterlegt (pbfUrl).`,
            ),
          );
      }

      // Dieselbe Sperre wie beim Kachelbau, und aus einem zusaetzlichen
      // Grund: Kachel- und Graphbau nebeneinander sprengen den Speicher der
      // 8-GB-VM, auf der auch Home Assistant laeuft.
      const running = jobs.findUnfinished(BUILD_JOB_KIND);
      if (running) {
        return reply.code(409).send(
          createErrorResponse(
            'BUILD_IN_PROGRESS',
            'Es läuft bereits ein Bau. Zwei schwere Bauten gleichzeitig überlasten ' +
              'das Gerät — warten Sie das Ende ab oder brechen Sie den laufenden Bau ab.',
            { jobId: running.id },
          ),
        );
      }

      const freeMemFn = opts.buildDeps?.freeMemFn ?? defaultFreeMem;
      const requiredMemory = buildRequiredFreeMemory();
      const freeMemory = freeMemFn();
      if (freeMemory < requiredMemory) {
        return reply.code(409).send(
          createErrorResponse(
            'INSUFFICIENT_MEMORY',
            'Zu wenig freier Arbeitsspeicher für den Bau des Routinggraphen. Schalten ' +
              'Sie Photon in der Add-on-Konfiguration ab („photon_enabled: false") und ' +
              'versuchen Sie es erneut.',
            { requiredBytes: requiredMemory, freeBytes: freeMemory },
          ),
        );
      }

      const jobId = jobs.create(BUILD_JOB_KIND);
      runBuildJob(
        jobId,
        jobs,
        entry,
        tilesDir,
        { ...opts.buildDeps, logger: opts.buildDeps?.logger ?? ((line) => fastify.log.info(line)) },
        GRAPH_BUILD,
      );
      return reply.code(202).send({ job_id: jobId });
    },
  );

  // POST /api/v1/map/regions/:id/build-search-index -- baut den OFFLINE-
  // SUCHINDEX aus demselben OSM-Extrakt.
  //
  // Bis 0.3.3 sagten Installationspruefung, Dockerfile und Doku
  // uebereinstimmend, das ginge auf dem Geraet nicht: das Werkzeug brauche
  // `osmium` und einen Repository-Checkout. Beides stimmte -- und beides war
  // eine Verpackungsentscheidung. `osmium-tool` ist ein Ubuntu-Paket, und das
  // Index-Werkzeug fehlte nur, weil der Core-Build allein `src/index.ts` als
  // Einstiegspunkt fuehrte. Der Quelltext liegt seit E05-T5 fertig da.
  //
  // Vierter Fall derselben Klasse in dieser Serie (Kachelbau, Routinggraph,
  // JAR-Modus, jetzt der Index): ein dokumentierter Weg, der nicht begehbar
  // war -- und jedes Mal hat die Doku den Betreiber an einen zweiten Rechner
  // geschickt, den es nie gebraucht haette.
  fastify.post<{ Params: IdParams; Reply: PostRegionsReply | ApiError }>(
    '/api/v1/map/regions/:id/build-search-index',
    async (request, reply) => {
      const regionId = request.params.id;
      if (!REGION_NAME_PATTERN.test(regionId)) {
        return reply
          .code(400)
          .send(createErrorResponse('INVALID_REGION', 'id must be a valid region slug'));
      }

      let catalog: CatalogEntry[];
      try {
        catalog = await loadCatalog();
      } catch (err) {
        fastify.log.error({ error: (err as Error).message }, 'Failed to load regions catalog');
        return reply
          .code(500)
          .send(createErrorResponse('CATALOG_UNAVAILABLE', 'Regions catalog could not be loaded'));
      }

      const entry = catalog.find((candidate) => candidate.id === regionId);
      if (!entry) {
        return reply
          .code(404)
          .send(createErrorResponse('NOT_FOUND', `Unknown catalog region '${regionId}'`));
      }

      if (!entry.pbfUrl) {
        return reply
          .code(409)
          .send(
            createErrorResponse(
              'NO_BUILD_SOURCE',
              `Für die Region '${regionId}' ist kein OSM-Extrakt hinterlegt (pbfUrl).`,
            ),
          );
      }

      // Dieselbe Sperre wie beim Kachelbau, und aus einem zusaetzlichen
      // Grund: Kachel- und Graphbau nebeneinander sprengen den Speicher der
      // 8-GB-VM, auf der auch Home Assistant laeuft.
      const running = jobs.findUnfinished(BUILD_JOB_KIND);
      if (running) {
        return reply.code(409).send(
          createErrorResponse(
            'BUILD_IN_PROGRESS',
            'Es läuft bereits ein Bau. Zwei schwere Bauten gleichzeitig überlasten ' +
              'das Gerät — warten Sie das Ende ab oder brechen Sie den laufenden Bau ab.',
            { jobId: running.id },
          ),
        );
      }

      const freeMemFn = opts.buildDeps?.freeMemFn ?? defaultFreeMem;
      const requiredMemory = buildRequiredFreeMemory();
      const freeMemory = freeMemFn();
      if (freeMemory < requiredMemory) {
        return reply.code(409).send(
          createErrorResponse(
            'INSUFFICIENT_MEMORY',
            'Zu wenig freier Arbeitsspeicher für den Bau des Suchindex. Schalten ' +
              'Sie Photon in der Add-on-Konfiguration ab („photon_enabled: false") und ' +
              'versuchen Sie es erneut.',
            { requiredBytes: requiredMemory, freeBytes: freeMemory },
          ),
        );
      }

      const jobId = jobs.create(BUILD_JOB_KIND);
      runBuildJob(
        jobId,
        jobs,
        entry,
        tilesDir,
        { ...opts.buildDeps, logger: opts.buildDeps?.logger ?? ((line) => fastify.log.info(line)) },
        LITE_INDEX_BUILD,
      );
      return reply.code(202).send({ job_id: jobId });
    },
  );

  // DELETE /api/v1/map/regions/:id -- refuses to remove the last region.
  fastify.delete<{ Params: IdParams; Reply: ApiError | undefined }>(
    '/api/v1/map/regions/:id',
    async (request, reply) => {
      const regionId = request.params.id;
      if (!REGION_NAME_PATTERN.test(regionId)) {
        return reply.code(400).send(createErrorResponse('INVALID_REGION', 'Region name is invalid'));
      }

      const filePath = resolveRegionFilePath(tilesDir, regionId);
      if (!filePath || !existsSync(filePath)) {
        return reply.code(404).send(createErrorResponse('NOT_FOUND', `Region '${regionId}' not found`));
      }

      const installed = await listRegions(tilesDir, fastify.log);
      if (installed.length <= 1) {
        return reply
          .code(409)
          .send(createErrorResponse('LAST_REGION', 'Cannot delete the only installed region'));
      }

      await unlink(filePath);
      return reply.code(204).send(undefined);
    },
  );

  // GET /api/v1/jobs/:id -- job status (progress, bytes, error).
  fastify.get<{ Params: IdParams; Reply: JobReply | ApiError }>(
    '/api/v1/jobs/:id',
    async (request, reply) => {
      const job = jobs.get(request.params.id);
      if (!job) {
        return reply
          .code(404)
          .send(createErrorResponse('NOT_FOUND', `Job '${request.params.id}' not found`));
      }
      return reply.code(200).send({ data: job });
    },
  );

  // DELETE /api/v1/jobs/:id -- cancels a queued/running job.
  fastify.delete<{ Params: IdParams; Reply: ApiError | undefined }>(
    '/api/v1/jobs/:id',
    async (request, reply) => {
      const job = jobs.get(request.params.id);
      if (!job) {
        return reply
          .code(404)
          .send(createErrorResponse('NOT_FOUND', `Job '${request.params.id}' not found`));
      }
      const cancelled = jobs.cancel(request.params.id);
      if (!cancelled) {
        return reply
          .code(409)
          .send(createErrorResponse('JOB_NOT_CANCELLABLE', `Job '${request.params.id}' has already finished`));
      }
      return reply.code(204).send(undefined);
    },
  );
};
