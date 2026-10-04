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

  it('spielt die Musik über Beats Player in diesem Browser, mischt der die Ansage selbst ein', async () => {
    const player = { name: 'Yapaia iPad', hoertHier: () => true, sprich: vi.fn(async () => true) };
    vi.stubGlobal('window', { ...globalThis, top: { YapaiaBeatMa: player }, location: { origin: 'http://ha:8123' } });
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ data: { ueber_radio: false, im_browser: { pfad: '/api/tts_proxy/x.mp3' } } })),
    );
    vi.stubGlobal('fetch', fetch);
    const sprich = vi.fn();
    expect(await sageAn('Jetzt rechts', 'navigation', sprich)).toEqual({ weg: 'browser' });
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({
      browser_player: 'Yapaia iPad',
    });
    expect(player.sprich).toHaveBeenCalledWith('http://ha:8123/api/tts_proxy/x.mp3');
    expect(sprich).not.toHaveBeenCalled();
  });

  it('klappt das Einmischen im Browser nicht, spricht die App selbst', async () => {
    const player = { name: 'Yapaia iPad', hoertHier: () => true, sprich: vi.fn(async () => false) };
    vi.stubGlobal('window', { ...globalThis, top: { YapaiaBeatMa: player }, location: { origin: 'http://ha:8123' } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: { ueber_radio: false, im_browser: { pfad: '/p.mp3' } } }))),
    );
    const sprich = vi.fn();
    expect(await sageAn('X', 'hinweis', sprich)).toEqual({ weg: 'selbst' });
    expect(sprich).toHaveBeenCalledWith('X');
  });

  it('spielt Beats Player hier nicht, fragt die App ohne browser_player', async () => {
    const player = { name: 'Yapaia iPad', hoertHier: () => false, sprich: vi.fn(async () => true) };
    vi.stubGlobal('window', { ...globalThis, top: { YapaiaBeatMa: player } });
    const fetch = vi.fn(async () => antwort(true));
    vi.stubGlobal('fetch', fetch);
    await sageAn('Y', 'hinweis', vi.fn());
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      text: 'Y',
      prioritaet: 'hinweis',
    });
  });

  it('eine überholte Ansage entfällt', async () => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('fetch', vi.fn(async () => antwort(false)));
    const sprich = vi.fn();
    await Promise.all([sageAn('alt', 'navigation', sprich), sageAn('neu', 'navigation', sprich)]);
    expect(sprich.mock.calls).toEqual([['neu']]);
  });
});
