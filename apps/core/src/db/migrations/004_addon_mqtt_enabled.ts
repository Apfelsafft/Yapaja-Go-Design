/**
 * 004_addon_mqtt_enabled -- per-add-on "In Home Assistant verfügbar" toggle
 * (E09-T8, docs/05 §2 "Optional pro Add-on abschaltbar"). Additive; per
 * `README.md`, `001_baseline.ts`/`002_addons.ts`/`003_addon_tokens.ts` are
 * never edited.
 *
 * `DEFAULT 1` (enabled): an add-on's `events.publish` output is ALREADY
 * confined to its own `addon/{id}/*` namespace before this column is even
 * consulted (`normalizeAddonEventTopic` + `buildAddonMqttTopic`, see
 * `mqtt/addonTopic.ts`) -- this toggle is a visibility/convenience control
 * for the operator, not a security boundary, so "republish by default,
 * opt out" is the more useful default (mirrors "Optional... abschaltbar":
 * the feature is on unless the operator turns it off).
 *
 * Read LIVE by `MqttBridge` on every `addon/*` bus event via
 * `AddonRepository#isMqttEnabled` (never cached) -- this is what makes the
 * toggle take effect immediately (acceptance criterion 3): no restart, no
 * reconnect, the very next event already sees the new value.
 */

import type { Migration } from './types.js';

export const addonMqttEnabled: Migration = {
  version: 4,
  name: '004_addon_mqtt_enabled',
  up(db) {
    db.exec(`ALTER TABLE addons ADD COLUMN mqtt_enabled INTEGER NOT NULL DEFAULT 1`);
  },
};
