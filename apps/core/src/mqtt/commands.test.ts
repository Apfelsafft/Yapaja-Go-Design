/* eslint-disable no-undef -- `Buffer` is a standard Node global (typed via
 * @types/node); the shared eslint config's `globals` list predates this
 * backend module. Same justification as position/service.ts. */

/**
 * Unit tests for `yapaja/cmd/*` payload parsing (E08-T1). Pure -- no
 * services/MQTT client involved.
 */
import { describe, it, expect } from 'vitest';
import {
  extractRequestId,
  parseDestinationCommand,
  parseFavoriteCommand,
  parseNavigationCommand,
  parseProfileCommand,
} from './commands.js';

function buf(text: string): Buffer {
  return Buffer.from(text, 'utf8');
}

describe('parseDestinationCommand', () => {
  it('accepts {query, autostart}', () => {
    const result = parseDestinationCommand(buf(JSON.stringify({ query: 'Vaduz', autostart: true })));
    expect(result).toEqual({ ok: true, value: { query: 'Vaduz', autostart: true, requestId: undefined } });
  });

  it('accepts {lat, lon} without autostart (defaults false)', () => {
    const result = parseDestinationCommand(buf(JSON.stringify({ lat: 47.1, lon: 9.5 })));
    expect(result).toEqual({
      ok: true,
      value: { latlng: { lat: 47.1, lon: 9.5 }, autostart: false, requestId: undefined },
    });
  });

  it('passes through request_id', () => {
    const result = parseDestinationCommand(
      buf(JSON.stringify({ query: 'Vaduz', request_id: 'abc-123' })),
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.requestId).toBe('abc-123');
  });

  it('rejects a payload with neither query nor lat+lon', () => {
    const result = parseDestinationCommand(buf(JSON.stringify({ autostart: true })));
    expect(result.ok).toBe(false);
  });

  it('rejects non-JSON / non-object payloads without throwing', () => {
    expect(parseDestinationCommand(buf('not json')).ok).toBe(false);
    expect(parseDestinationCommand(buf('42')).ok).toBe(false);
    expect(parseDestinationCommand(buf('')).ok).toBe(false);
  });
});

describe('parseNavigationCommand', () => {
  it.each(['start', 'pause', 'resume', 'stop'] as const)('accepts bare unquoted "%s"', (action) => {
    const result = parseNavigationCommand(buf(action));
    expect(result).toEqual({ ok: true, value: { action, requestId: undefined } });
  });

  it('accepts a JSON-quoted string payload', () => {
    const result = parseNavigationCommand(buf('"pause"'));
    expect(result).toEqual({ ok: true, value: { action: 'pause', requestId: undefined } });
  });

  it('accepts an {action, request_id} object form', () => {
    const result = parseNavigationCommand(buf(JSON.stringify({ action: 'stop', request_id: 'r1' })));
    expect(result).toEqual({ ok: true, value: { action: 'stop', requestId: 'r1' } });
  });

  it('rejects an unknown action', () => {
    const result = parseNavigationCommand(buf('teleport'));
    expect(result.ok).toBe(false);
  });
});

describe('parseProfileCommand', () => {
  it('accepts {id}', () => {
    const result = parseProfileCommand(buf(JSON.stringify({ id: 'p1' })));
    expect(result).toEqual({ ok: true, value: { id: 'p1', name: undefined, requestId: undefined } });
  });

  it('accepts {name}', () => {
    const result = parseProfileCommand(buf(JSON.stringify({ name: 'Camper' })));
    expect(result).toEqual({ ok: true, value: { id: undefined, name: 'Camper', requestId: undefined } });
  });

  it('rejects a payload with neither id nor name', () => {
    expect(parseProfileCommand(buf(JSON.stringify({}))).ok).toBe(false);
  });
});

describe('parseFavoriteCommand', () => {
  it('accepts {name}', () => {
    const result = parseFavoriteCommand(buf(JSON.stringify({ name: 'Campingplatz Bodensee' })));
    expect(result).toEqual({
      ok: true,
      value: { name: 'Campingplatz Bodensee', requestId: undefined },
    });
  });

  it('rejects an empty/whitespace-only name', () => {
    expect(parseFavoriteCommand(buf(JSON.stringify({ name: '  ' }))).ok).toBe(false);
    expect(parseFavoriteCommand(buf(JSON.stringify({}))).ok).toBe(false);
  });
});

describe('extractRequestId', () => {
  it('reads request_id off a JSON object payload', () => {
    expect(extractRequestId({ request_id: 'xyz' })).toBe('xyz');
  });
  it('returns undefined for non-objects or a missing/non-string request_id', () => {
    expect(extractRequestId('start')).toBeUndefined();
    expect(extractRequestId({})).toBeUndefined();
    expect(extractRequestId({ request_id: 42 })).toBeUndefined();
  });
});
