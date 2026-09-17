/**
 * Unit tests for the region-manager fetch client (E01-T5).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  deleteRegion,
  fetchCatalog,
  fetchInstalledRegions,
  fetchJob,
  startDownload,
  startGraphBuild,
  RegionApiError,
} from './client';

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('fetchInstalledRegions', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches from a BASE_URL-relative path and returns the data array', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ region: 'germany', size_bytes: 100 }] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const regions = await fetchInstalledRegions();
    expect(regions).toEqual([{ region: 'germany', size_bytes: 100 }]);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('api/v1/map/regions'));
    expect(fetchMock.mock.calls[0][0]).not.toMatch(/^https?:\/\//);
  });

  it('returns [] (never throws) on a non-ok response or network error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({}, false)) as unknown as typeof fetch;
    expect(await fetchInstalledRegions()).toEqual([]);

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect(await fetchInstalledRegions()).toEqual([]);
  });
});

describe('fetchCatalog', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches the catalog endpoint (never the raw region host)', async () => {
    const entry = { id: 'liechtenstein', name: 'Liechtenstein', installed: false };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [entry] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const catalog = await fetchCatalog();
    expect(catalog).toEqual([entry]);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('api/v1/map/regions/catalog'));
    expect(fetchMock.mock.calls[0][0]).not.toMatch(/^https?:\/\//);
  });

  it('returns [] on failure, never throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect(await fetchCatalog()).toEqual([]);
  });
});

describe('startDownload', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs region_id and returns the job_id on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ job_id: 'job-123' }, true, 202));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const jobId = await startDownload('liechtenstein');
    expect(jobId).toBe('job-123');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('api/v1/map/regions');
    expect(url).not.toMatch(/^https?:\/\//);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ region_id: 'liechtenstein' });
  });

  it('throws a RegionApiError carrying code/message/details on a 409', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'INSUFFICIENT_SPACE',
            message: 'Not enough free disk space to download this region',
            details: { requiredBytes: 1000, freeBytes: 10 },
          },
        },
        false,
        409,
      ),
    ) as unknown as typeof fetch;

    await expect(startDownload('germany')).rejects.toMatchObject({
      code: 'INSUFFICIENT_SPACE',
      details: { requiredBytes: 1000, freeBytes: 10 },
    });
  });

  it('falls back to a generic RegionApiError if the error body is malformed', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({}, false, 500)) as unknown as typeof fetch;
    await expect(startDownload('germany')).rejects.toBeInstanceOf(RegionApiError);
  });
});

describe('fetchJob', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches job status by id from a relative URL', async () => {
    const snapshot = { id: 'job-1', status: 'running', progress: 0.5, bytes: 500, totalBytes: 1000, error: null };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: snapshot }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const job = await fetchJob('job-1');
    expect(job).toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('api/v1/jobs/job-1'));
  });

  it('returns null (never throws) on failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect(await fetchJob('job-1')).toBeNull();
  });
});

describe('deleteRegion', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('DELETEs the region path and resolves on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(undefined, true, 204));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(deleteRegion('germany')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('api/v1/map/regions/germany');
    expect(init.method).toBe('DELETE');
  });

  it('throws a RegionApiError with code LAST_REGION on a 409', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'LAST_REGION', message: 'Cannot delete the only installed region' } }, false, 409),
    ) as unknown as typeof fetch;

    await expect(deleteRegion('solo')).rejects.toMatchObject({ code: 'LAST_REGION' });
  });
});

/**
 * ─── DIE RUECKFRAGE ZUR ROUTING-ABDECKUNG ───────────────────────────────────
 *
 * Der Kern lehnt einen Routingbau mit 409 `COVERAGE_LOSS` ab, wenn danach
 * eine installierte Karte ohne Straßendaten dastünde. In 0.10.1 gab es kein
 * Feld, mit dem man ihn hätte bestätigen können — die Warnung war damit eine
 * Sackgasse: sie stand da, und der Betreiber kam nicht an ihr vorbei.
 *
 * Deshalb prüfen diese Tests nicht bloß, dass ein Feld mitgeht, sondern dass
 * es sich zwischen den beiden Aufrufen auch UNTERSCHEIDET. Ein fest
 * verdrahtetes `true` bestünde sonst denselben Test — und hätte die
 * Rückfrage klammheimlich ganz abgeschafft.
 */
describe('startGraphBuild', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function gesendeterKoerper(mock: ReturnType<typeof vi.fn>): { abdeckung_bestaetigt?: boolean } {
    return JSON.parse((mock.mock.calls[0][1] as { body: string }).body) as {
      abdeckung_bestaetigt?: boolean;
    };
  }

  it('fragt ohne Bestätigung — der Kern soll die Rückfrage stellen dürfen', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ job_id: 'j1' }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await startGraphBuild('germany')).toBe('j1');
    expect(gesendeterKoerper(fetchMock).abdeckung_bestaetigt).toBe(false);
  });

  it('reicht die Bestätigung durch, wenn sie gegeben wurde', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ job_id: 'j2' }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await startGraphBuild('germany', true)).toBe('j2');
    expect(gesendeterKoerper(fetchMock).abdeckung_bestaetigt).toBe(true);
  });

  it('gibt COVERAGE_LOSS als RegionApiError MIT Code weiter', async () => {
    // Die Oberfläche unterscheidet daran Rückfrage von Fehler. Ginge der Code
    // verloren, landete die Frage wieder in der roten Zeile ohne Ausweg.
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        { error: { code: 'COVERAGE_LOSS', message: 'Ohne Routing bleiben: mein-bundesland.' } },
        false,
        409,
      ),
    ) as unknown as typeof fetch;

    await expect(startGraphBuild('germany')).rejects.toMatchObject({
      code: 'COVERAGE_LOSS',
    });
  });
});
