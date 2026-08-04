/**
 * Global-Setup der E10-T2-Performance-Suite.
 *
 * Baut und startet einen ECHTEN, gebauten Core -- dieselbe Mechanik wie die
 * Haupt-Harness und die Sicherheits-Suite, ueber die gemeinsamen Helfer aus
 * `apps/web/e2e/support/coreProcess.ts` (E09-T6 hat sie genau dafuer
 * extrahiert). Es gibt in diesem Repo weiterhin genau EINEN Weg, einen Core
 * fuer Tests hochzuziehen.
 *
 * Zusaetzlich zur Haupt-Harness passiert hier dreierlei:
 *  1. Die PID des Core-Prozesses wird festgehalten -- sie ist die einzige
 *     RSS-Zahl, die diese Umgebung ehrlich messen kann (`90-rss.spec.ts`).
 *  2. Die Messumgebung wird signiert (CPU-Throttle, Viewport, GL-Renderer,
 *     vCPU-Zahl). Ohne diese Signatur waere jeder Trend-Vergleich wertlos,
 *     weil er ueber Maschinengrenzen hinweg rechnen wuerde.
 *  3. `VALHALLA_URL` zeigt auf den Stub-Port, den `20-reroute.spec.ts` selbst
 *     bedient -- exakt das Muster aus `flow-03-wrong-turn-reroute.spec.ts`,
 *     weil der Reroute SERVERSEITIG ausgeloest wird und `page.route()` ihn
 *     deshalb nicht erreichen kann.
 */

import { cpus } from 'os';
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ChildProcess } from 'child_process';
import { chromium } from '@playwright/test';
import {
  buildApps,
  preparePublicDir,
  resetDir,
  startCore,
  waitForHealth,
} from '../../../apps/web/e2e/support/coreProcess.js';
import { resolvePreinstalledChromium } from '../../../apps/web/e2e/support/chromium.js';
import { buildPMTilesFixtureBuffer } from '../../../apps/core/src/map/__fixtures__/pmtiles-fixture.js';
import { DISCLAIMER_VERSION } from '../../../apps/web/src/onboarding/state.js';
import type { EnvironmentSignature } from '../trend.js';
import {
  CPU_THROTTLE_RATE,
  PERF_CORE_BASE_URL,
  PERF_CORE_PID_FILE,
  PERF_CORE_PORT,
  PERF_ENVIRONMENT_FILE,
  PERF_SOAK_TILES_DIR,
  PERF_TILES_DIR,
  PERF_TMP_DIR,
  PERF_VALHALLA_BASE_URL,
  PERF_VIEWPORT,
  PERF_VIEWPORT_LABEL,
  SOAK_CORE_BASE_URL,
  SOAK_CORE_PORT,
  soakEnabled,
} from './constants.js';
import { isSoftwareRenderer, readGlRenderer } from './page.js';
import { resetMeasurements } from './measure.js';

async function seedOnboardingCompleted(baseUrl: string): Promise<void> {
  await fetch(`${baseUrl}/api/v1/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      onboarding_state: {
        step: 'mqtt',
        completed: true,
        disclaimer: { version: DISCLAIMER_VERSION, acceptedAt: new Date().toISOString() },
      },
    }),
  });
}

function gitSha(): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/**
 * Liest den GL-Renderer einmal zentral aus, statt ihn in jeder Spec neu zu
 * ermitteln -- er ist eine Eigenschaft der Maschine, nicht des Testfalls.
 */
async function detectEnvironment(): Promise<EnvironmentSignature> {
  const browser = await chromium.launch({
    executablePath: resolvePreinstalledChromium(),
    args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  try {
    const page = await browser.newPage({ viewport: { ...PERF_VIEWPORT } });
    const glRenderer = await readGlRenderer(page);
    return {
      cpuThrottleRate: CPU_THROTTLE_RATE,
      viewport: PERF_VIEWPORT_LABEL,
      glRenderer,
      cpuCount: cpus().length,
    };
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  mkdirSync(PERF_TMP_DIR, { recursive: true });
  resetMeasurements();

  buildApps();
  preparePublicDir();

  resetDir(PERF_TILES_DIR);
  writeFileSync(join(PERF_TILES_DIR, 'fixture.pmtiles'), buildPMTilesFixtureBuffer({}));

  const cores: ChildProcess[] = [];

  const core = startCore(PERF_CORE_PORT, PERF_TILES_DIR, {
    // Der Reroute wird serverseitig berechnet; der Stub laeuft in
    // `20-reroute.spec.ts` (gleiche Aufteilung wie flow-03).
    VALHALLA_URL: PERF_VALHALLA_BASE_URL,
  });
  cores.push(core);

  try {
    await waitForHealth(PERF_CORE_BASE_URL, 30_000);
  } catch (err) {
    for (const c of cores) c.kill();
    throw err;
  }
  await seedOnboardingCompleted(PERF_CORE_BASE_URL);

  if (core.pid === undefined) {
    for (const c of cores) c.kill();
    throw new Error('Core-Prozess ohne PID -- ohne PID ist die RSS-Messung nicht moeglich.');
  }
  writeFileSync(PERF_CORE_PID_FILE, String(core.pid), 'utf8');

  if (soakEnabled()) {
    resetDir(PERF_SOAK_TILES_DIR);
    writeFileSync(join(PERF_SOAK_TILES_DIR, 'fixture.pmtiles'), buildPMTilesFixtureBuffer({}));
    const soakCore = startCore(SOAK_CORE_PORT, PERF_SOAK_TILES_DIR);
    cores.push(soakCore);
    try {
      await waitForHealth(SOAK_CORE_BASE_URL, 30_000);
    } catch (err) {
      for (const c of cores) c.kill();
      throw err;
    }
    await seedOnboardingCompleted(SOAK_CORE_BASE_URL);
    if (soakCore.pid === undefined) {
      for (const c of cores) c.kill();
      throw new Error('Soak-Core ohne PID -- die RSS-Drift waere nicht messbar.');
    }
    writeFileSync(join(PERF_TMP_DIR, 'soak-core.pid'), String(soakCore.pid), 'utf8');
  }

  const environment = await detectEnvironment();
  writeFileSync(
    PERF_ENVIRONMENT_FILE,
    JSON.stringify({ environment, gitSha: gitSha() }, null, 2),
    'utf8',
  );

  console.warn(
    `[Perf] Messumgebung: CPU-Throttle ${environment.cpuThrottleRate}x, ${environment.viewport}, ` +
      `${environment.cpuCount} vCPU, GL "${environment.glRenderer}"` +
      (isSoftwareRenderer(environment.glRenderer)
        ? ' -> SOFTWARE-Rasterung, fps-Metriken sind hier nur Hinweis (siehe e2e/perf/README.md)'
        : ''),
  );

  return async () => {
    for (const c of cores) c.kill();
  };
}
