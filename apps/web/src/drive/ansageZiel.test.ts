import { afterEach, describe, expect, it, vi } from 'vitest';
import { sageAn } from './ansageZiel.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const antwort = (ueber_radio: boolean) => new Response(JSON.stringify({ data: { ueber_radio } }));

describe('sageAn', () => {
  it('mischt Yapaia Beat die Ansage ein, spricht die App nicht zusätzlich', async () => {
    vi.stubGlobal('window', globalThis);
    const fetch = vi.fn(async () => antwort(true));
    vi.stubGlobal('fetch', fetch);
    const sprich = vi.fn();
    await sageAn('Jetzt links', 'navigation', sprich);
    expect(fetch.mock.calls[0]?.[0]).toMatch(/api\/v1\/ansage$/);
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      text: 'Jetzt links',
      prioritaet: 'navigation',
    });
    expect(sprich).not.toHaveBeenCalled();
  });

  it('kein Radio oder kein Kern: die App spricht selbst', async () => {
    vi.stubGlobal('window', globalThis);
    const sprich = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => antwort(false)));
    await sageAn('A', 'hinweis', sprich);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('weg'))));
    await sageAn('B', 'hinweis', sprich);
    expect(sprich.mock.calls).toEqual([['A'], ['B']]);
  });

  it('eine überholte Ansage entfällt', async () => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('fetch', vi.fn(async () => antwort(false)));
    const sprich = vi.fn();
    await Promise.all([sageAn('alt', 'navigation', sprich), sageAn('neu', 'navigation', sprich)]);
    expect(sprich.mock.calls).toEqual([['neu']]);
  });
});
