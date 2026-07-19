/* eslint-disable no-undef -- `AbortSignal` is a standard Node global (typed via
 * @types/node); same justification as search/httpTypes.ts. */

/**
 * Unit tests for `callHaService` (E08-T3): the request shape, and the hard
 * rule that it NEVER throws -- timeouts and HTTP errors resolve to `false`.
 */

import { describe, it, expect } from 'vitest';
import { callHaService, type HaFetchLike, type HaClientLogger } from './client.js';

const connection = { apiBase: 'http://ha.local:8123/api', token: 'llt' };
const logger: HaClientLogger = { info: () => {}, warn: () => {}, error: () => {} };

describe('callHaService', () => {
  it('POSTs to /services/<domain>/<service> with the bearer token + JSON body', async () => {
    let capturedUrl = '';
    let capturedInit: { method: string; headers: Record<string, string>; body: string } | null = null;
    const fetch: HaFetchLike = (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return Promise.resolve({ ok: true, status: 200 });
    };

    const ok = await callHaService(
      { connection, domain: 'tts', service: 'speak', data: { message: 'hallo' } },
      { fetch, logger },
    );

    expect(ok).toBe(true);
    expect(capturedUrl).toBe('http://ha.local:8123/api/services/tts/speak');
    expect(capturedInit!.method).toBe('POST');
    expect(capturedInit!.headers.Authorization).toBe('Bearer llt');
    expect(capturedInit!.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(capturedInit!.body)).toEqual({ message: 'hallo' });
  });

  it('returns false (never throws) on an HTTP error status', async () => {
    const fetch: HaFetchLike = () => Promise.resolve({ ok: false, status: 502 });
    await expect(
      callHaService({ connection, domain: 'notify', service: 'x', data: {} }, { fetch, logger }),
    ).resolves.toBe(false);
  });

  it('aborts on timeout and returns false (never throws)', async () => {
    // A fetch that only settles when its AbortSignal fires -> forces the
    // timeout path deterministically without a real clock wait beyond timeoutMs.
    const fetch: HaFetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });

    const result = await callHaService(
      { connection, domain: 'tts', service: 'speak', data: {} },
      { fetch, logger, timeoutMs: 20 },
    );
    expect(result).toBe(false);
  });
});
