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
import { FavoriteService } from './favorites/service.js';
import { settingsPlugin } from './settings/routes.js';
import { SettingsService } from './settings/service.js';
import { resolveMqttConfig, resolveDiscoveryConfig } from './mqtt/config.js';
import { MqttBridge } from './mqtt/bridge.js';
import { AuthGuard } from './auth/authGuard.js';
import { authPlugin } from './auth/plugin.js';
import { HaOutputChannel } from './ha/outputChannel.js';
import { serveIndexHtml } from './static/ingressHtml.js';
import { systemPlugin } from './system/routes.js';
import { readPackageVersion } from './version.js';
import { addonsPlugin } from './addons/routes.js';

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

  // E08-T3: settings store is created HERE (earlier than E07-T1 originally
  // placed it) so the auth guard below can read the live `auth.token` and the
  // HA output channel can read the live `ha` config. The SAME instance is
  // shared with `settingsPlugin` (and the MQTT bridge) further down -- exactly
  // the "build outside, inject via `service:`" pattern used for the routing/
  // search/navigation services.
  const settingsService = new SettingsService();

  // E08-T3 token auth (docs/04 §2, SECURITY): a Bearer token guards `/api/*`
  // (health + auth/status open). Auth is ENFORCED only when a token is
  // configured (env `API_AUTH_TOKEN` wins, else Settings `auth.token`) and NOT
  // in ingress mode -- a fresh, token-less install stays open so the bundled UI
  // and `/ws/v1` work out of the box (see `auth/authGuard.ts` for the full
  // rationale + trade-off). Registered BEFORE every API route plugin so its
  // root `onRequest` hook applies to all of them.
  const authGuard = new AuthGuard({ settings: settingsService });
  await fastify.register(authPlugin, {
    guard: authGuard,
    settings: settingsService,
  });

  // E06-T1/T3: `onProfileChanged` (fired by `ProfileService#activate`) is
  // published as `event/profile_changed` -- the ONLY way `NavigationService`
  // (wired further below, sharing this SAME instance via `profilesPlugin`'s
  // `service` option) learns a profile switch happened, so it can couple it
  // to a reroute decision while navigating/paused.
  const profileService = new ProfileService({
    onProfileChanged: (profile) => {
      eventBus.publish('event/profile_changed', { id: profile.id, name: profile.name });
    },
    // E08-T2: create/update/delete -> re-publish `select.yapaja_profile`'s
    // HA discovery `options` (see `mqtt/bridge.ts`'s `event/profile_list_changed`
    // subscription).
    onProfileListChanged: () => {
      eventBus.publish('event/profile_list_changed', {});
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

  await fastify.register(busWebsocketPlugin, {
    bus: eventBus,
    registry: wsClientRegistry,
    // E08-T3: the `/ws/v1` upgrade authenticates via `?token=`/cookie, same
    // "enforced only when a token is configured (and not in ingress)" rule.
    authGuard,
  });
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

  // General-purpose settings plugin (E07-T1): additive, does not touch other
  // plugins. The widget-shell's `layouts` key is its first consumer (see
  // `apps/web/src/shell/persistence.ts`); future settings (units, theme,
  // online_fallback, ...) reuse the same key/value store. The SAME
  // `settingsService` instance created at the top of `buildServer` (so the auth
  // guard + HA output channel + MQTT bridge all read the SAME live settings) is
  // injected here rather than letting the plugin build its own.
  await fastify.register(settingsPlugin, { prefix: '/api/v1', service: settingsService });

  // Add-on manifest/install/lifecycle plugin (E09-T1, docs/05 §2/§5):
  // additive, does not touch other plugins. `coreVersion: version` reuses
  // the SAME `readPackageVersion()` result `/api/v1/health` reports above
  // for the manifest `core_api` semver-range check (Wargame W-11) -- see
  // `addons/installService.ts`. This task only covers manifest validation +
  // install/lifecycle + DB + tarball-extraction hardening; it does not start
  // any add-on service process or serve add-on UIs (E09-T2/T3).
  await fastify.register(addonsPlugin, { prefix: '/api/v1', coreVersion: version });

  // System resources (E08-T5, W-12/W-18): real measured free/total disk (of
  // the map-tiles data dir) + free/total RAM, for the onboarding wizard's
  // region step to derive its "< 3 GB free -> recommend Photon off"
  // recommendation from. Additive; does not touch other plugins.
  await fastify.register(systemPlugin);

  // MQTT bridge (E08-T1, docs/03 §4): OPTIONAL -- only constructed when a
  // broker is configured (Settings key `mqtt` and/or env `MQTT_BROKER_URL`,
  // see `mqtt/config.ts`). Shares the SAME bus/navigationService/
  // profileService/routingService/searchService instances wired above (no
  // second bus, no duplicated business logic -- see `mqtt/bridge.ts` and
  // `navigation/destinationResolver.ts`). `FavoriteService` is the one
  // exception: it is entirely stateless (every call re-reads the shared DB
  // singleton, see `favorites/service.ts`), so a second instance here is
  // behaviourally identical to the one `favoritesPlugin` builds internally --
  // no shared-instance requirement, unlike `profileService`/`navigationService`
  // (which carry live state/hooks) or `eventBus` (a single in-memory router).
  const mqttConfig = resolveMqttConfig({ settings: settingsService, env: process.env });
  // E08-T2: discovery is resolved independent of `mqttConfig` (its own
  // Setting-key fields, `mqtt.discovery`/`mqtt.discovery_prefix`/
  // `mqtt.configuration_url`, default enabled) but only ever matters when a
  // broker is ALSO configured -- no broker, no bridge, no discovery, same as
  // every other MQTT behaviour (acceptance criterion 4).
  const discoveryConfig = resolveDiscoveryConfig({ settings: settingsService, env: process.env });
  const mqttLogger = {
    info: (msg: string, meta?: Record<string, unknown>) => fastify.log.info(meta ?? {}, msg),
    warn: (msg: string, meta?: Record<string, unknown>) => fastify.log.warn(meta ?? {}, msg),
    error: (msg: string, meta?: Record<string, unknown>) => fastify.log.error(meta ?? {}, msg),
  };
  const mqttBridge = mqttConfig
    ? new MqttBridge({
        bus: eventBus,
        brokerUrl: mqttConfig.brokerUrl,
        username: mqttConfig.username,
        password: mqttConfig.password,
        prefix: mqttConfig.prefix,
        navigationService,
        profileService,
        favoriteService: new FavoriteService(),
        routeProvider: routingService,
        rerouteProvider: routingService,
        profileProvider: profileService,
        searchProvider: searchService,
        logger: mqttLogger,
        discovery: {
          enabled: discoveryConfig.enabled,
          discoveryPrefix: discoveryConfig.discoveryPrefix,
          device: {
            identifiers: ['yapaja_go'],
            name: 'Yapaja Go',
            // SAME version `/api/v1/health` reports (`readPackageVersion()` above).
            sw_version: version,
            configuration_url: discoveryConfig.configurationUrl,
          },
        },
      })
    : null;
  if (mqttConfig) {
    fastify.log.info({ prefix: mqttConfig.prefix }, 'MQTT bridge configured, connecting…');
  }
  fastify.addHook('onClose', async () => {
    mqttBridge?.dispose();
  });

  // HA output channel (E08-T3, docs/04 §2): OPTIONAL Yapaja -> HA direction --
  // an "HA-TTS" announcement sink (W-23: mutually exclusive with browser TTS,
  // selected by Settings `ha.announce_sink`) plus arrival / GPS-lost HA
  // notifications. Always constructed (it's just a bus subscriber); it does
  // NOTHING until HA is configured in Settings (or via env `SUPERVISOR_TOKEN`
  // as an add-on) -- see `ha/config.ts`. Every HA REST call has a 5 s timeout
  // and swallows errors, so a down/misconfigured HA never affects navigation.
  const haOutputChannel = new HaOutputChannel({
    bus: eventBus,
    settings: settingsService,
    logger: {
      info: (msg, meta) => fastify.log.info(meta ?? {}, msg),
      warn: (msg, meta) => fastify.log.warn(meta ?? {}, msg),
      error: (msg, meta) => fastify.log.error(meta ?? {}, msg),
    },
  });
  fastify.addHook('onClose', async () => {
    haOutputChannel.dispose();
  });

  fastify.get<{ Reply: HealthResponse }>('/api/v1/health', async (_request, _reply) => {
    const dbHealth = await profileService.checkHealth();
    return {
      status: 'ok',
      version,
      services: {
        db: dbHealth ? 'ok' : 'down',
        mqtt: mqttBridge ? mqttBridge.getHealthStatus() : 'disabled',
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

    // GET / -- explicit route (rather than relying on @fastify/static's
    // default index-file serving via its `/*` wildcard) so we can inject the
    // HA-Ingress `<base href>` (E08-T4, docs/04 §3, W-15; see
    // `static/ingressHtml.ts`). An exact route always wins over the static
    // plugin's `/*` wildcard in fastify's router regardless of registration
    // order, so this does not change how any other asset path is served.
    fastify.get('/', async (request, reply) => {
      await serveIndexHtml(publicDir, request, reply);
    });

    // Add a catch-all route for SPA fallback to index.html for non-API routes.
    // Goes through the same `serveIndexHtml` helper as `GET /` above so the
    // ingress base-href injection applies to deep-linked SPA routes too.
    fastify.setNotFoundHandler(async (request, reply) => {
      if (!request.url.startsWith('/api')) {
        return serveIndexHtml(publicDir, request, reply);
      }
      reply.code(404).send({ error: 'Not Found' });
    });
  }

  return fastify;
}

/**
 * Resolves the bind host. An explicit `HOST` always wins. Otherwise, in HA
 * ingress mode (`INGRESS_MODE=1`) HA proxies requests to the add-on over the
 * container's internal interface and the port is NOT published externally, so
 * we still bind `0.0.0.0` (the interface HA's ingress reaches) but auth is
 * already handled by ingress (see `AuthGuard`); operators who publish the port
 * directly instead set `HOST`/`API_AUTH_TOKEN` explicitly. Outside ingress the
 * default is `0.0.0.0` (LAN device).
 */
function resolveBindHost(env: Record<string, string | undefined>): string {
  if (typeof env.HOST === 'string' && env.HOST.length > 0) return env.HOST;
  return '0.0.0.0';
}

async function main(): Promise<void> {
  const port = parseInt(process.env.PORT || '8080', 10);
  const host = resolveBindHost(process.env);

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
