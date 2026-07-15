import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import pino from 'pino';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { profilesPlugin } from './profiles/routes.js';
import { ProfileService } from './profiles/service.js';
import { EventBus } from './bus/index.js';
import { busWebsocketPlugin } from './bus/ws.js';
import { PositionService } from './position/service.js';
import { positionPlugin } from './position/routes.js';
import { DeadReckoningController, noopDeadReckoningProvider } from './position/deadReckoning.js';
import { SimulatorSource } from './position/simulator/index.js';
import { simulatorPlugin } from './position/simulator/routes.js';
import { GpsdSource } from './position/gpsd/index.js';
import { mapPlugin } from './map/routes.js';
import { routingPlugin } from './routing/routes.js';
import { searchPlugin } from './search/routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface HealthResponse {
  status: string;
  version: string;
  services: Record<string, string>;
}

export interface BuildServerOptions {
  publicDir?: string;
}

/**
 * `GPSD_ENABLED` gates whether the core actively tries to connect to gpsd
 * at startup. Explicit `'true'`/`'1'`/`'false'`/`'0'` always win; with the
 * var unset, default to enabled only when `NODE_ENV=production` (Compose/
 * HA-add-on) -- mirrors the inverse-polarity pattern already used for
 * `ENABLE_SIMULATOR` in position/simulator/routes.ts (env override + a
 * NODE_ENV-based default), just flipped: gpsd should be on by default in
 * production and off by default elsewhere, simulator is the other way
 * round.
 */
function isGpsdEnabled(): boolean {
  const raw = process.env.GPSD_ENABLED;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return process.env.NODE_ENV === 'production';
}

async function readPackageVersion(): Promise<string> {
  try {
    const packagePath = join(__dirname, '../../package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
    return packageJson.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: true,
  });

  const version = await readPackageVersion();
  const profileService = new ProfileService();

  // Initialize profile service
  await profileService.init();

  // Register profiles plugin
  await fastify.register(profilesPlugin, { prefix: '/api/v1' });

  // Internal event bus (ADR-010) + position service (ADR-007)
  const eventBus = new EventBus();
  const positionService = new PositionService({ bus: eventBus });
  // GPS simulator position source (E02-T4): registers as 'simulator' with
  // the same PositionService registry the real gpsd/browser sources use.
  const simulatorSource = new SimulatorSource(positionService);
  positionService.registerSource(simulatorSource);

  // gpsd position source (E02-T3, ADR-007): registers exactly like the
  // simulator source above. Connecting is gated by GPSD_ENABLED so that
  // dev/test runs of buildServer() don't spam background reconnect
  // attempts against a gpsd daemon that (usually) isn't running locally;
  // production/HA-add-on deployments (which always ship a gpsd service,
  // docs/01 ADR-008) default to enabled. Either way, an unreachable gpsd
  // never crashes the core -- the source just stays inactive and
  // PositionService falls back to the next-priority source (ADR-007).
  const gpsdSource = new GpsdSource({
    positionService,
    host: process.env.GPSD_HOST,
    port: process.env.GPSD_PORT ? parseInt(process.env.GPSD_PORT, 10) : undefined,
  });
  positionService.registerSource(gpsdSource);
  if (isGpsdEnabled()) {
    gpsdSource.start();
  }

  // Dead-reckoning (E02-T5, W-01): extrapolates the puck for up to 30s after
  // GPS is lost. `noopDeadReckoningProvider` is a placeholder until E04-T6
  // ships the real route-based math -- until then this never actually
  // publishes `pos/extrapolated`, so the puck just freezes.
  const deadReckoningController = new DeadReckoningController({
    bus: eventBus,
    service: positionService,
    provider: noopDeadReckoningProvider,
  });

  fastify.addHook('onClose', async () => {
    deadReckoningController.dispose();
    simulatorSource.dispose();
    gpsdSource.dispose();
    positionService.dispose();
  });

  await fastify.register(busWebsocketPlugin, { bus: eventBus });
  await fastify.register(positionPlugin, { prefix: '/api/v1', service: positionService });
  await fastify.register(simulatorPlugin, {
    prefix: '/api/v1',
    simulator: simulatorSource,
    service: positionService,
  });

  // Register map/tiles plugin (E01-T1): additive, does not touch other plugins.
  await fastify.register(mapPlugin);

  // Routing plugin (E03-T2, 🔴 W-08): maps the active vehicle profile onto
  // Valhalla truck costing. Additive; the Valhalla base URL comes from
  // VALHALLA_URL (defaults to http://localhost:8002 inside the client).
  await fastify.register(routingPlugin, {
    prefix: '/api/v1',
    positionService,
    profileService,
    valhallaUrl: process.env.VALHALLA_URL,
  });

  // Search plugin (E05-T1): Photon + Nominatim-Fallback geocoding, additive.
  // `online_fallback` defaults to false (docs/03 §2, E05-T1) -- online
  // Nominatim lookups only run when explicitly opted in via env.
  await fastify.register(searchPlugin, {
    prefix: '/api/v1',
    photonUrl: process.env.PHOTON_URL,
    onlineFallback: process.env.SEARCH_ONLINE_FALLBACK === 'true',
    lang: process.env.SEARCH_LANG,
  });

  fastify.get<{ Reply: HealthResponse }>('/api/v1/health', async (_request, _reply) => {
    const dbHealth = await profileService.checkHealth();
    return {
      status: 'ok',
      version,
      services: {
        db: dbHealth ? 'ok' : 'down',
      },
    };
  });

  // Register static file serving for the web application.
  // The server must still start when the public/ directory does not exist (local dev).
  const publicDir = opts.publicDir ?? join(__dirname, '../public');
  if (existsSync(publicDir)) {
    await fastify.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
    });

    // Add a catch-all route for SPA fallback to index.html for non-API routes
    fastify.setNotFoundHandler(async (_request, reply) => {
      if (!_request.url.startsWith('/api')) {
        return reply.sendFile('index.html');
      }
      reply.code(404).send({ error: 'Not Found' });
    });
  }

  return fastify;
}

async function main(): Promise<void> {
  const port = parseInt(process.env.PORT || '8080', 10);
  const host = process.env.HOST || '0.0.0.0';

  // Create structured logger using pino
  const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
  });

  const fastify = await buildServer();

  const gracefulShutdown = async (): Promise<void> => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  try {
    await fastify.listen({ port, host });
    logger.info(`Server running at http://${host}:${port}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
}

// Only start the server when this module is executed directly (not when imported, e.g. in tests)
const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectExecution) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
