/**
 * Unit tests for the add-on bus-topic -> MQTT-topic translation (E09-T8).
 *
 * These are the HOSTILE-INPUT tests the task's plausibility criterion asks
 * for: "Add-on kann keine `yapaja/cmd/*`- oder Core-Status-Topics
 * publizieren (Topic-Namespace-Test)". `buildAddonMqttTopic` is exercised
 * DIRECTLY here (bypassing the REST layer) so every case is a pure,
 * deterministic function call; `bridge.integration.test.ts` separately
 * proves the SAME guarantee end-to-end against a real broker through the
 * real `POST /addons/:id/events` route.
 *
 * Every hostile input below is fed the SAME two things an attacker actually
 * controls: the bus topic's SUFFIX (whatever `normalizeAddonEventTopic`, the
 * upstream namespace guard, already allowed through) and -- separately -- a
 * malformed `addon/{id}/...` shape that upstream guard could never itself
 * produce, to prove this module does not blindly trust its caller either.
 */
import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { parseAddonBusTopic, buildAddonMqttTopic, MAX_MQTT_TOPIC_BYTES } from './addonTopic.js';
import { normalizeAddonEventTopic } from '../addons/scopeMatrix.js';

const PREFIX = 'yapaja';
const ID = 'com.example.addon';

/** NUL and DEL, built via String.fromCharCode -- deliberately never a
 *  literal control byte typed into this source file. */
const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(127);

describe('parseAddonBusTopic', () => {
  it('splits a well-formed addon/{id}/{suffix} topic', () => {
    expect(parseAddonBusTopic(`addon/${ID}/started`)).toEqual({ addonId: ID, suffix: 'started' });
  });

  it('keeps a multi-level suffix intact', () => {
    expect(parseAddonBusTopic(`addon/${ID}/a/b/c`)).toEqual({ addonId: ID, suffix: 'a/b/c' });
  });

  it.each([
    'nav/state', // not addon/* at all
    'pos/update',
    'addon/', // no id, no suffix
    `addon/${ID}`, // no suffix at all
    `addon/${ID}/`, // trailing slash, empty suffix
    'addon//suffix', // empty id
    '',
  ])('refuses "%s"', (topic) => {
    expect(parseAddonBusTopic(topic)).toBeNull();
  });
});

describe('buildAddonMqttTopic -- happy path', () => {
  it('builds the namespaced MQTT topic for a simple suffix', () => {
    expect(buildAddonMqttTopic(PREFIX, `addon/${ID}/started`)).toBe(`${PREFIX}/addon/${ID}/started`);
  });

  it('preserves a multi-level suffix', () => {
    expect(buildAddonMqttTopic(PREFIX, `addon/${ID}/a/b/c`)).toBe(`${PREFIX}/addon/${ID}/a/b/c`);
  });

  it('a non-ASCII suffix round-trips unchanged (MQTT topics are UTF-8)', () => {
    const topic = `addon/${ID}/gefunden-ausflugsziel-ueoess-nihongo-テスト`;
    expect(buildAddonMqttTopic(PREFIX, topic)).toBe(`${PREFIX}/${topic}`);
  });
});

describe('buildAddonMqttTopic -- hostile inputs are REJECTED, never sanitized', () => {
  it.each([
    // --- MQTT wildcard metacharacters: the concrete DoS this module exists
    // to prevent (aedes disconnects a client that PUBLISHes these; see the
    // module doc comment and bridge.integration.test.ts). Every shape below
    // is a bus topic `normalizeAddonEventTopic` WOULD allow through (it only
    // forbids `*`, not `+`/`#`) -- confirmed by the "upstream allows this"
    // block further down.
    ['single-level wildcard as the whole suffix', `addon/${ID}/+`],
    ['multi-level wildcard as the whole suffix', `addon/${ID}/#`],
    ['wildcard embedded mid-segment', `addon/${ID}/foo+bar`],
    ['wildcard as one level of a longer suffix', `addon/${ID}/a/+/b`],
    ['trailing multi-level wildcard after real levels', `addon/${ID}/status/#`],

    // --- empty segments (double slash) -------------------------------------
    ['empty segment in the middle of the suffix', `addon/${ID}/a//b`],

    // --- control characters -------------------------------------------------
    ['a NUL byte', `addon/${ID}/evil${NUL}topic`],
    ['a newline', `addon/${ID}/evil\ntopic`],
    ['a DEL byte', `addon/${ID}/evil${DEL}topic`],

    // --- malformed id (this module's OWN defense-in-depth id re-check,
    // independent of the fact that an installed id could never actually be
    // this) --------------------------------------------------------------
    ['id containing a slash (would climb out of its own namespace)', 'addon/../cmd/started'],
    ['id containing a wildcard', 'addon/+/started'],
    ['id with uppercase (ADDON_ID_PATTERN is lowercase-only)', 'addon/Com.Example/started'],
    ['empty id (double slash right after addon/)', 'addon//started'],

    // --- not addon/* at all --------------------------------------------------
    ['a bare core topic, not addon/*', 'nav/state'],
    ['a cmd topic, not addon/*', 'cmd/destination'],
  ])('rejects: %s', (_label, busTopic) => {
    expect(buildAddonMqttTopic(PREFIX, busTopic)).toBeNull();
  });

  it('rejects a topic that would exceed the byte cap', () => {
    const hugeSuffix = 'x'.repeat(MAX_MQTT_TOPIC_BYTES + 10);
    expect(buildAddonMqttTopic(PREFIX, `addon/${ID}/${hugeSuffix}`)).toBeNull();
  });

  it('accepts a topic just under the byte cap', () => {
    // Budget: prefix + '/addon/' + id + '/' -- fill the rest with 'x'.
    const overhead = Buffer.byteLength(`${PREFIX}/addon/${ID}/`, 'utf8');
    const suffix = 'x'.repeat(MAX_MQTT_TOPIC_BYTES - overhead);
    const topic = buildAddonMqttTopic(PREFIX, `addon/${ID}/${suffix}`);
    expect(topic).not.toBeNull();
    expect(Buffer.byteLength(topic as string, 'utf8')).toBeLessThanOrEqual(MAX_MQTT_TOPIC_BYTES);
  });
});

describe('the gap this module closes: upstream ALLOWS these, this module must NOT', () => {
  // Each of these is a bus topic that `normalizeAddonEventTopic` (the
  // upstream, bus-namespace guard) genuinely lets through -- proving the
  // rejections above are not redundant with the existing check, but close a
  // real, distinct gap it leaves open.
  it.each([`${ID}/+`, `${ID}/#`, `${ID}/a/+/b`, `${ID}/status/#`, `${ID}/a//b`])(
    'upstream normalizeAddonEventTopic allows "%s" onto the bus, buildAddonMqttTopic must still refuse it',
    (relativeTopic) => {
      const busTopic = normalizeAddonEventTopic(ID, relativeTopic);
      expect(busTopic).not.toBeNull(); // the bus-namespace guard is fine with it...
      expect(buildAddonMqttTopic(PREFIX, busTopic as string)).toBeNull(); // ...but MQTT must never see it
    },
  );
});

describe('never produces a topic outside {prefix}/addon/{id}/*', () => {
  it('every ACCEPTED topic starts with the exact expected namespace prefix', () => {
    const cases = [`addon/${ID}/started`, `addon/${ID}/a/b/c`, `addon/${ID}/${'x'.repeat(50)}`];
    for (const busTopic of cases) {
      const mqttTopic = buildAddonMqttTopic(PREFIX, busTopic);
      expect(mqttTopic).not.toBeNull();
      expect((mqttTopic as string).startsWith(`${PREFIX}/addon/${ID}/`)).toBe(true);
    }
  });

  it('can never produce yapaja/cmd/* or yapaja/nav/* however the suffix is crafted', () => {
    // Even a suffix that literally SPELLS "cmd/destination" just nests
    // harmlessly under the add-on's own namespace -- it is not, and cannot
    // become, the real `yapaja/cmd/destination` topic.
    const mqttTopic = buildAddonMqttTopic(PREFIX, `addon/${ID}/cmd/destination`);
    expect(mqttTopic).toBe(`${PREFIX}/addon/${ID}/cmd/destination`);
    expect(mqttTopic).not.toBe(`${PREFIX}/cmd/destination`);
  });
});
