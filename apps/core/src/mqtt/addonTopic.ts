/**
 * Bus-topic -> MQTT-topic translation for add-on events (E09-T8, docs/03 §4,
 * docs/05 §2 `events.publish`: "auch -> MQTT `yapaja/addon/{id}/*`").
 *
 * THE UPSTREAM GUARANTEE THIS BUILDS ON, AND WHY IT IS NOT ENOUGH ALONE:
 * `addon/*` bus events are published from EXACTLY ONE place --
 * `POST /addons/:id/events` (`../addons/serviceRoutes.ts`) -- which forces
 * every topic through `normalizeAddonEventTopic` (`../addons/scopeMatrix.ts`)
 * first. That function guarantees the resulting bus topic starts with
 * `addon/{id}/` and rejects `*`, `..`, and a leading/trailing `/`. It does
 * NOT know or care about MQTT wire semantics, because on the internal bus
 * there IS no such thing as a wildcard character -- `topicMatches()`
 * (`../bus/index.ts`) only ever treats a trailing `*` on a SUBSCRIBER's
 * pattern specially, never on a published topic. So a bus topic like
 * `addon/{id}/a/+/b` or `addon/{id}/#` sails straight through the upstream
 * check (verified in `scopeMatrix.test.ts`) -- it is a perfectly ordinary,
 * safe BUS topic string.
 *
 * It is NOT a safe MQTT topic string. Per the MQTT spec (MQTT-4.7.1-1), a
 * PUBLISH Topic Name must never contain the wildcard characters `+`/`#` --
 * some brokers (this repo's own `aedes`, see its `test/topics.js`) actively
 * enforce this by raising a `clientError` and CLOSING the offending client's
 * connection. Naively republishing an add-on's bus topic verbatim as the
 * MQTT topic string would therefore let a hostile OR merely buggy add-on
 * knock the Core's OWN MqttBridge connection off the broker -- taking the
 * entire HA/MQTT integration (position, nav state, every OTHER add-on's
 * events, ...) down with it. That is the concrete bug this module exists to
 * prevent; see `bridge.integration.test.ts`'s "malformed suffix keeps the
 * bridge connection alive" test for a reproduction with the defense removed.
 *
 * This module is therefore a SECOND, INDEPENDENT layer of defense for a
 * DIFFERENT concern than `normalizeAddonEventTopic`'s: that one guarantees
 * NAMESPACE containment (never escape `addon/{id}/*`), this one guarantees
 * MQTT WIRE safety (never an invalid/dangerous MQTT topic string) of
 * whatever already-namespace-safe bus topic is handed to it. Both must pass
 * before an add-on event reaches the broker.
 *
 * Policy: REJECT, never sanitize-and-publish-anyway. A topic that fails any
 * check here is simply never published (logged and dropped by the caller,
 * `bridge.ts`) -- the same "refuse, don't mangle" choice
 * `normalizeAddonEventTopic` already made for the bus-namespace layer.
 */

import { Buffer } from 'node:buffer';
import { ADDON_ID_PATTERN } from '@yapaja/shared';

/** Belt-and-suspenders re-check of the add-on id segment. By construction an
 *  `addon/*` bus topic's id was already validated against this exact pattern
 *  at INSTALL time (`packages/shared/src/schemas/addon-manifest.ts` -- an id
 *  becomes the `data/addons/{id}` directory name, so it was already hardened
 *  against `/`, `..`, and non-allow-listed characters there). Re-testing it
 *  here costs nothing and means this module never has to trust that an
 *  upstream caller passed a genuinely-installed id. */
const ADDON_ID_RE = new RegExp(ADDON_ID_PATTERN);

/**
 * MQTT wildcard metacharacters (`+`, `#`) plus every ASCII control character
 * (`\x00`-`\x1F`) and DEL (`\x7F`). Wildcards are the protocol-breaking case
 * (see the module doc comment above); control characters are rejected as
 * defense-in-depth hygiene -- nothing in a topic suffix has a legitimate
 * reason to carry a NUL, newline, or other control byte, and the MQTT spec's
 * "SHOULD NOT" on them is not a guarantee every broker/subscriber honours
 * gracefully.
 *
 * Deliberately NOT restricted to ASCII: MQTT topics are UTF-8 by spec, and a
 * German umlaut or any other non-ASCII character in an add-on's own event
 * name is legitimate and safe -- it can never combine with `/` to change
 * topic-level structure, so there is nothing to gain by rejecting it (see
 * the "non-ASCII suffix round-trips" test).
 */
// eslint-disable-next-line no-control-regex -- the control-character range IS the check; see the doc comment above.
const FORBIDDEN_TOPIC_CHARS_RE = /[+#\x00-\x1F\x7F]/u;

/** MQTT's own hard cap (16-bit length-prefixed UTF-8) is 65535 bytes; this
 *  is a MUCH tighter, deliberately paranoid cap on the whole PUBLISHED topic
 *  string (prefix + `addon/{id}/` + suffix) -- there is no legitimate reason
 *  for an add-on's own topic to be anywhere near this long, and rejecting
 *  early avoids ever handing mqtt.js an oversized topic to begin with. */
export const MAX_MQTT_TOPIC_BYTES = 512;

export interface ParsedAddonBusTopic {
  /** The add-on id segment, e.g. `com.example.foo`. */
  addonId: string;
  /** Everything after `addon/{id}/` -- may itself contain further `/`s
   *  (`normalizeAddonEventTopic` allows e.g. `a/b/c`, see its test file). */
  suffix: string;
}

/**
 * Splits a bus topic of the shape `addon/{id}/{suffix}` into its id/suffix.
 * Returns `null` for anything that isn't exactly that shape, INCLUDING a bus
 * topic that isn't `addon/*` at all -- this function makes no assumption
 * about who calls it or what pattern they subscribed with.
 */
export function parseAddonBusTopic(busTopic: string): ParsedAddonBusTopic | null {
  if (typeof busTopic !== 'string') return null;
  if (!busTopic.startsWith('addon/')) return null;
  const rest = busTopic.slice('addon/'.length);
  const slashIdx = rest.indexOf('/');
  if (slashIdx <= 0) return null; // no `/` at all, or an EMPTY id before it
  const addonId = rest.slice(0, slashIdx);
  const suffix = rest.slice(slashIdx + 1);
  if (suffix === '') return null;
  return { addonId, suffix };
}

/** A single `/`-delimited topic level is safe for MQTT wire transport iff it
 *  is non-empty (rejects `a//b`, `a/`, `/a` -- an empty level is legal MQTT
 *  but has no legitimate use here and is exactly the shape a truncation/
 *  injection attempt would produce) and carries none of the forbidden
 *  characters above. */
function isSafeMqttTopicLevel(level: string): boolean {
  return level.length > 0 && !FORBIDDEN_TOPIC_CHARS_RE.test(level);
}

/**
 * Builds the final `{prefix}/addon/{id}/{suffix}` MQTT topic for an
 * ALREADY-namespace-safe bus topic (see the module doc comment for exactly
 * what "already-namespace-safe" means and where that guarantee comes from).
 * Returns `null` -- never publish -- for anything that is not cleanly
 * `addon/{id}/{suffix}` with an id matching {@link ADDON_ID_PATTERN}, a
 * suffix made only of safe levels (see {@link isSafeMqttTopicLevel}), and a
 * final topic under {@link MAX_MQTT_TOPIC_BYTES}.
 *
 * `prefix` is the OPERATOR-configured MQTT base topic (`mqtt.prefix`
 * Setting, resolved by `config.ts`) -- trusted input, same as everywhere
 * else `MqttBridge` uses `this.prefix` (status/nav/cmd topics), not part of
 * the add-on-controlled surface this function defends.
 */
export function buildAddonMqttTopic(prefix: string, busTopic: string): string | null {
  const parsed = parseAddonBusTopic(busTopic);
  if (!parsed) return null;
  const { addonId, suffix } = parsed;

  if (!ADDON_ID_RE.test(addonId)) return null;

  const suffixLevels = suffix.split('/');
  if (suffixLevels.some((level) => !isSafeMqttTopicLevel(level))) return null;

  const topic = `${prefix}/addon/${addonId}/${suffix}`;
  if (Buffer.byteLength(topic, 'utf8') > MAX_MQTT_TOPIC_BYTES) return null;
  return topic;
}
