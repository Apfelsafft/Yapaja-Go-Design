/**
 * Regression tests for `buildWebSocketUrl` (E10-T1).
 *
 * The FIRST test is the actual regression: served under a Home Assistant
 * ingress sub-path with Vite's relative `base: './'`, the WebSocket URL must
 * keep the sub-path. The old `new URL(basePath, location.origin)` form
 * produced `wss://host/ws/v1` here, which ingress does not route — so all
 * three WS managers silently never connected under ingress. See
 * `net/wsUrl.ts` for the full write-up.
 */

import { describe, it, expect } from 'vitest';
import { buildWebSocketUrl, type WsUrlLocation } from './wsUrl.js';

function location(href: string): WsUrlLocation {
  const url = new URL(href);
  return { protocol: url.protocol, host: url.host, href };
}

describe('buildWebSocketUrl', () => {
  it('keeps a Home Assistant ingress sub-path (the E10-T1 regression)', () => {
    expect(
      buildWebSocketUrl('./', location('https://ha.local:8123/hassio_ingress/abc123token/')),
    ).toBe('wss://ha.local:8123/hassio_ingress/abc123token/ws/v1');
  });

  it('keeps the sub-path when the document is a file inside it, not the directory', () => {
    expect(
      buildWebSocketUrl('./', location('https://ha.local:8123/hassio_ingress/abc123token/shell.html')),
    ).toBe('wss://ha.local:8123/hassio_ingress/abc123token/ws/v1');
  });

  it('is unchanged at the root (the non-ingress deployment)', () => {
    expect(buildWebSocketUrl('./', location('http://127.0.0.1:8080/'))).toBe(
      'ws://127.0.0.1:8080/ws/v1',
    );
  });

  it('uses ws: for http and wss: for https', () => {
    expect(buildWebSocketUrl('./', location('http://host/'))).toMatch(/^ws:\/\//);
    expect(buildWebSocketUrl('./', location('https://host/'))).toMatch(/^wss:\/\//);
  });

  it('accepts an absolute base path too', () => {
    expect(buildWebSocketUrl('/rv/', location('http://host/rv/index.html'))).toBe(
      'ws://host/rv/ws/v1',
    );
  });

  it('does not double the slash when the base has no trailing one', () => {
    expect(buildWebSocketUrl('/rv', location('http://host/rv'))).toBe('ws://host/rv/ws/v1');
  });

  it('falls back to the document directory when the base is empty', () => {
    expect(buildWebSocketUrl('', location('http://host/sub/dir/'))).toBe('ws://host/sub/dir/ws/v1');
  });

  it('preserves a non-default port', () => {
    expect(buildWebSocketUrl('./', location('http://127.0.0.1:4312/hassio_ingress/x/'))).toBe(
      'ws://127.0.0.1:4312/hassio_ingress/x/ws/v1',
    );
  });
});
