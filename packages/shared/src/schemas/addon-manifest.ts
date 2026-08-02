/**
 * JSON Schema for the add-on manifest `yapaja-addon.json` (E09-T1, docs/05
 * §2). Synchronized with types.ts `AddonManifest`.
 *
 * This schema only covers STRUCTURAL validation (types, required fields,
 * enums, string patterns) -- AJV can't call out to the hand-rolled semver
 * helpers, so `version`/`core_api` semantic validity (is it really a valid
 * semver / semver range?) is checked separately in
 * `validateAddonManifest`/`getValidationErrorsAddonManifest`
 * (`../validators.ts`), which layers `isValidSemver`/`isValidRange` on top
 * of this schema. Both layers must pass for a manifest to be accepted.
 *
 * `id` is validated here with `ADDON_ID_PATTERN` because it becomes a
 * DIRECTORY NAME under `data/addons/{id}/` at install time (see
 * `apps/core/src/addons/paths.ts`) -- this pattern is the FIRST line of
 * defense against a malicious `id` (`../../etc`, absolute paths, control
 * chars); the install pipeline does its own defense-in-depth path-resolve
 * check too, never trusting manifest validation alone.
 */

/**
 * Reverse-DNS-ish identifier: lowercase alphanumeric labels (may contain
 * internal hyphens, never leading/trailing) joined by single dots. Rejects
 * `/`, `\`, `..`, absolute-path markers, control characters, and anything
 * else that isn't in this character set by construction (the pattern is a
 * strict allow-list, not a denylist).
 */
export const ADDON_ID_PATTERN =
  '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$';

/**
 * Known permission scopes (docs/05 §2 table), v1. `net.fetch:<host>` is the
 * one open-ended scope -- validated by pattern (must carry a non-empty host
 * after the colon) rather than being in this fixed list.
 */
export const ADDON_PERMISSION_SCOPES = [
  'pos.read',
  'nav.read',
  'nav.control',
  'route.read',
  'route.propose',
  'map.layer.write',
  'widget.register',
  'events.publish',
  'storage.own',
  'ha.notify',
  'camera.view',
] as const;

/** Matches `net.fetch:<host>` with a non-empty host. */
export const ADDON_NET_FETCH_PATTERN = '^net\\.fetch:.+$';

export const addonManifestWidgetSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    slots: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
  required: ['id', 'name', 'slots'],
  additionalProperties: false,
} as const;

export const addonManifestMapLayerSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    source: { type: 'string', minLength: 1 },
  },
  required: ['id', 'name', 'source'],
  additionalProperties: false,
} as const;

export const addonManifestUiSchema = {
  type: 'object',
  properties: {
    entry: { type: 'string', minLength: 1 },
    widgets: { type: 'array', items: addonManifestWidgetSchema },
    map_layers: { type: 'array', items: addonManifestMapLayerSchema },
    settings_page: { type: 'boolean' },
  },
  required: ['entry'],
  additionalProperties: false,
} as const;

export const addonManifestServiceSchema = {
  type: 'object',
  properties: {
    runtime: { type: 'string', enum: ['node18', 'node20', 'external'] },
    entry: { type: 'string', minLength: 1 },
    /** E09-T3 / W-14: optional RSS ceiling in MB for a Core-spawned service
     *  process. The Core defaults to 256 MB when absent and clamps the value
     *  (see `addons/service-host.ts`) -- a manifest cannot grant itself
     *  unlimited memory. */
    max_rss_mb: { type: 'number', minimum: 16, maximum: 4096 },
  },
  required: ['runtime', 'entry'],
  additionalProperties: false,
} as const;

export const addonManifestSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      pattern: ADDON_ID_PATTERN,
      description: 'Reverse-DNS-ish identifier; becomes the data/addons/{id} directory name',
    },
    name: { type: 'string', minLength: 1 },
    version: { type: 'string', minLength: 1, description: 'Exact semver, e.g. "1.2.0"' },
    core_api: { type: 'string', minLength: 1, description: 'Semver range, e.g. "^1.0"' },
    author: { type: 'string', minLength: 1 },
    license: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    requires_online: { type: 'boolean' },
    ui: addonManifestUiSchema,
    service: addonManifestServiceSchema,
    permissions: {
      type: 'array',
      items: {
        type: 'string',
        anyOf: [{ enum: ADDON_PERMISSION_SCOPES }, { pattern: ADDON_NET_FETCH_PATTERN }],
      },
    },
  },
  required: ['id', 'name', 'version', 'core_api', 'author', 'license', 'description', 'permissions'],
  additionalProperties: false,
} as const;
