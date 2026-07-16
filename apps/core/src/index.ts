import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import pino from 'pino';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { profilesPlugin } from './profiles/routes.js';
import { ProfileService } from './profiles/service.js';
import { EventBus } from './bus/index.js';
import { busWebsocketPlugin, WsClientRegistry } from './bus/ws.js';
import { PositionService } from './position/service.js';
import { positionPlugin } from './position/routes.js';
import { DeadReckoningController } from './position/deadReckoning.js';
import { SimulatorSource } from './position/simulator/index.js';
import { simulatorPlugin } from './position/simulator/routes.js';
import { GpsdSource } from './position/gpsd/index.js';
import { mapPlugin } from './map/routes.js';
import { routingPlugin, buildRoutingService } from './routing/routes.js';
import { navigationPlugin } from './navigation/routes.js';
import { NavigationService } from './navigation/service.js';
import { RouteAwareDeadReckoningProvider, MAX_DEAD_RECKONING_WINDOW_MS } from './navigation/deadreckoning.js';
import { FileNavRecoveryStore } from './navigation/recoveryStore.js';
import { searchPlugin, buildSearchService } from './search/routes.js';
import { favoritesPlugin } from './favorites/routes.js';

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

  // Internal event bus (ADR-010) + WS-client presence tracker (E06-T3):
  // created BEFORE the profile service below so its `onProfileChanged` hook
  // can publish straight onto the bus.
  const eventBus = new EventBus();
  const wsClientRegistry = new WsClientRegistry();

  // E06-T1/T3: `onProfileChanged` (fired by `ProfileService#activate`) is
  // published as `event/profile_changed` -- the ONLY way `NavigationService`
  // (wired further below, sharing this SAME instance via `profilesPlugin`'s
  // `service` option) learns a profile switch happened, so it can couple it
  // to a reroute decision while navigating/paused.
  const profileService = new ProfileService({
    onProfileChanged: (profile) => {
      eventBus.publish('event/profile_changed', { id: profile.id, name: profile.name });
    },
  });

  // Initialize profile service
  await profileService.init();

  // Register profiles plugin. `service: profileService` -- the SAME instance
  // constructed above, not a second independent one -- is essential so
  // activations made through THESE HTTP routes are the ones that carry the
  // `onProfileChanged` hook (see comment above).
  await fastify.register(profilesPlugin, { prefix: '/api/v1', service: profileService });

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

  await fastify.register(busWebsocketPlugin, { bus: eventBus, registry: wsClientRegistry });
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
  // The RoutingService is built HERE (not inside the plugin) so the exact
  // same instance -- and its route cache -- is shared with the navigation
  // plugin below (E04-T1: `POST /navigation/start {route_id}` looks routes up
  // in that cache).
  const routingService = buildRoutingService(fastify, {
    positionService,
    profileService,
    valhallaUrl: process.env.VALHALLA_URL,
  });
  await fastify.register(routingPlugin, {
    prefix: '/api/v1',
    positionService,
    profileService,
    service: routingService,
  });

  // Search service (E05-T1, built here rather than inside `searchPlugin` --
  // E04-T5 needs the SAME instance for `POST /navigation/destination`'s
  // `query` -> geocode path, mirroring how `routingService` above is shared
  // between the routing and navigation plugins). `online_fallback` defaults
  // to false (docs/03 §2, E05-T1) -- online Nominatim lookups only run when
  // explicitly opted in via env. E05-T5/W-12: `photon_enabled` defaults to
  // true (env `PHOTON_ENABLED=false` to turn Photon off, e.g. to save RAM) --
  // the offline `lite` fallback then takes over automatically (also used
  // whenever Photon is merely down).
  const searchService = buildSearchService(fastify, {
    photonUrl: process.env.PHOTON_URL,
    onlineFallback: process.env.SEARCH_ONLINE_FALLBACK === 'true',
    photonEnabled: process.env.PHOTON_ENABLED !== 'false',
    liteDbPath: process.env.LITE_SEARCH_DB_PATH,
    lang: process.env.SEARCH_LANG,
  });

  // Navigation service (E04-T1, 🔴 safety-critical): state machine +
  // map-matching, driven off `pos/update`, publishing `nav/state` at ~1 Hz.
  // Restart recovery (W-19) persists only the last active route reference to
  // a small JSON file; navigation itself always boots `idle` (no ghost nav).
  //
  // Constructed HERE (not inside `navigationPlugin`, which otherwise builds
  // its own) so E04-T6's `DeadReckoningController` below can hold a direct
  // reference to it: `NavigationService` implements `DeadReckoningRouteSource`
  // (its `getActiveForDeadReckoning()` is the DR provider's live route/
  // progress/next-maneuver/speed source) -- same "build outside, inject via
  // `service:`" pattern already used for `routingService`/`searchService` above.
  const navigationLogger = {
    info: (msg: string, meta?: Record<string, unknown>) => fastify.log.info(meta ?? {}, msg),
    warn: (msg: string, meta?: Record<string, unknown>) => fastify.log.warn(meta ?? {}, msg),
    error: (msg: string, meta?: Record<string, unknown>) => fastify.log.error(meta ?? {}, msg),
  };
  const navigationService = new NavigationService({
    bus: eventBus,
    routeProvider: routingService,
    // E04-T4: automatic rerouting reuses the SAME shared RoutingService — its
    // `createRoutes` is the reroute entry point (cache also shared with
    // routeProvider above). E04-T5's `POST /navigation/destination` reuses
    // the very same seam to compute the initial route to a `latlng`/`query`.
    rerouteProvider: routingService,
    // E04-T2: the ETA avg-speed floor reads the active profile directly off
    // ProfileService (same instance the routing plugin above uses). E04-T5's
    // destination endpoint also falls back to it when no `profile_id` is given.
    profileProvider: profileService,
    // E06-T3: "is a UI client connected?" -- decides confirmation-banner vs.
    // headless auto-reroute when the active profile changes mid-navigation.
    clientPresence: wsClientRegistry,
    recoveryStore: new FileNavRecoveryStore(
      process.env.NAV_RECOVERY_PATH ?? join(__dirname, '../.data/nav-recovery.json'),
      {
        fs: { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync },
        dirname,
        logger: { warn: (msg, meta) => fastify.log.warn(meta ?? {}, msg) },
      },
    ),
    logger: navigationLogger,
  });

  // Dead-reckoning (E02-T5 scaffold, E04-T6 real math, Wargame W-01):
  // extrapolates the puck ALONG THE ACTIVE ROUTE for up to 30s after GPS is
  // lost, using `navigationService` as the live route/progress/speed source
  // -- `RouteAwareDeadReckoningProvider` replaces the E02-T5 placeholder
  // (`noopDeadReckoningProvider`, which always declined and left the puck
  // frozen). `navigationService` itself also subscribes to the resulting
  // `pos/extrapolated` fixes (its own `pos/extrapolated` bus subscription,
  // see `navigation/service.ts`) to keep announcements/`nav/state` running
  // through the outage and to pause navigation after the 30s cap.
  const deadReckoningController = new DeadReckoningController({
    bus: eventBus,
    service: positionService,
    provider: new RouteAwareDeadReckoningProvider(navigationService),
    maxWindowMs: MAX_DEAD_RECKONING_WINDOW_MS,
  });

  fastify.addHook('onClose', async () => {
    deadReckoningController.dispose();
    navigationService.dispose();
    simulatorSource.dispose();
    gpsdSource.dispose();
    positionService.dispose();
  });

  // Navigation plugin: REST routes only (`POST /navigation/*`, `GET
  // /navigation/state`) -- `service: navigationService` makes it reuse the
  // SAME instance constructed above rather than building a second one.
  await fastify.register(navigationPlugin, {
    prefix: '/api/v1',
    bus: eventBus,
    service: navigationService,
    routeProvider: routingService,
    rerouteProvider: routingService,
    profileProvider: profileService,
    // E04-T5: `POST /navigation/destination`'s `query` -> geocode path (the
    // same shared SearchService instance registered below) -- used directly
    // by the route handler even when `service` is injected.
    searchProvider: searchService,
    clientPresence: wsClientRegistry,
  });

  // Search plugin (E05-T1): Photon + Nominatim-Fallback geocoding, additive.
  await fastify.register(searchPlugin, {
    prefix: '/api/v1',
    service: searchService,
  });

  // Favorites & history plugin (E05-T3, docs/03 §2): additive, does not
  // touch other plugins.
  await fastify.register(favoritesPlugin, { prefix: '/api/v1' });

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
