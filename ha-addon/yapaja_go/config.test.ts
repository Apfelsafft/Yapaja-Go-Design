/**
 * In-repo, fully deterministic structural check for `config.yaml` (E08-T4).
 *
 * This is the PER-PR merge-gate counterpart to `frenck/action-addon-linter`
 * (which runs nightly, `continue-on-error`, see `ha-addon/README.md` "CI
 * strategy" for the full rationale). It does not attempt to reproduce the
 * Supervisor's entire config schema -- only the specific, load-bearing keys
 * `tasks/E08-home-assistant.md` and `docs/04-home-assistant.md` §3 call out
 * explicitly, so a typo/regression in any of them fails fast, in-repo, with
 * no network dependency and no third-party Action that could itself be
 * flaky or unavailable.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { load } from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADDON_DIR = __dirname;
const CONFIG_PATH = join(ADDON_DIR, 'config.yaml');

/** Supervisor's default when `ingress_port` is omitted from config.yaml. */
const SUPERVISOR_DEFAULT_INGRESS_PORT = 8099;

interface AddonConfig {
  name: string;
  slug: string;
  version: string;
  arch: string[];
  ingress: boolean;
  ingress_port?: number;
  ports: Record<string, unknown>;
  map: string[];
  services: string[];
  usb: boolean;
  udev: boolean;
  options: Record<string, unknown>;
  schema: Record<string, unknown>;
}

function loadConfig(): AddonConfig {
  const raw = readFileSync(CONFIG_PATH, 'utf-8');
  const parsed = load(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('config.yaml did not parse to an object');
  }
  return parsed as AddonConfig;
}

describe('ha-addon/yapaja_go/config.yaml is valid YAML with the required HA add-on keys', () => {
  it('parses as YAML without error', () => {
    expect(() => loadConfig()).not.toThrow();
  });

  it('has the required top-level identity fields', () => {
    const config = loadConfig();
    expect(config.name).toBe('Yapaja Go');
    expect(config.slug).toBe('yapaja_go');
    expect(typeof config.version).toBe('string');
    expect(config.version.length).toBeGreaterThan(0);
  });

  it('declares amd64 + aarch64 architectures', () => {
    const config = loadConfig();
    expect(Array.isArray(config.arch)).toBe(true);
    expect(config.arch).toContain('amd64');
    expect(config.arch).toContain('aarch64');
  });

  /**
   * `ingress_port` is deliberately NOT set in config.yaml: 8099 is already the
   * Supervisor default, and `frenck/action-addon-linter` (nightly, E08-T4)
   * rejects keys that only restate a default.
   *
   * That makes the port coupling IMPLICIT, so this test makes it explicit
   * again -- which is the more valuable assertion anyway. What actually has to
   * hold is that the port the container LISTENS on is the port Ingress will
   * dial. Asserting `typeof ingress_port === 'number'` (the previous version)
   * never checked that: it would have happily passed with a port the Core
   * does not serve.
   */
  it('is Ingress-enabled, and the container listens on exactly the Ingress port', () => {
    const config = loadConfig();
    expect(config.ingress).toBe(true);

    // Not set = Supervisor default 8099.
    const ingressPort = config.ingress_port ?? SUPERVISOR_DEFAULT_INGRESS_PORT;
    expect(Number.isInteger(ingressPort)).toBe(true);
    expect(ingressPort).toBeGreaterThan(0);

    // ... and that is the port the container is actually configured to serve.
    const initScript = readFileSync(
      join(ADDON_DIR, 'rootfs', 'etc', 'yapaja', 'init-yapaja-config.sh'),
      'utf-8',
    );
    const exported = /export_env "PORT" "(\d+)"/.exec(initScript);
    expect(exported, 'init-yapaja-config.sh must export a PORT default').not.toBeNull();
    expect(Number(exported?.[1])).toBe(ingressPort);

    const dockerfile = readFileSync(join(ADDON_DIR, 'Dockerfile'), 'utf-8');
    expect(dockerfile).toContain(`EXPOSE ${ingressPort}`);
  });

  it('is Ingress-only by default (no published ports)', () => {
    const config = loadConfig();
    expect(config.ports).toEqual({});
  });

  it('maps /share as read-write (W-16: data survives updates)', () => {
    const config = loadConfig();
    expect(Array.isArray(config.map)).toBe(true);
    expect(config.map).toContain('share:rw');
  });

  it('declares mqtt:need so bashio provides broker credentials automatically', () => {
    const config = loadConfig();
    expect(Array.isArray(config.services)).toBe(true);
    expect(config.services).toContain('mqtt:need');
  });

  it('declares usb + udev for GPS-receiver passthrough', () => {
    const config = loadConfig();
    expect(config.usb).toBe(true);
    expect(config.udev).toBe(true);
  });

  it('has the required option/schema keys from docs/04 §3 (region, mqtt_prefix, photon, gps_source, log_level, memory tuning)', () => {
    const config = loadConfig();
    const requiredKeys = [
      'region',
      'mqtt_prefix',
      'photon_enabled',
      'gps_source',
      'log_level',
      'photon_xmx_mb',
      'valhalla_memory_mb',
    ];
    for (const key of requiredKeys) {
      expect(config.options, `options.${key} missing`).toHaveProperty(key);
      expect(config.schema, `schema.${key} missing`).toHaveProperty(key);
    }
  });

  it('every options key has a matching schema key and vice versa (no orphaned entries)', () => {
    const config = loadConfig();
    const optionKeys = Object.keys(config.options).sort();
    const schemaKeys = Object.keys(config.schema).sort();
    expect(optionKeys).toEqual(schemaKeys);
  });
});
