import { afterEach, describe, expect, it, vi } from 'vitest';
import { nimmAnsage } from './AnsageKanal.js';

afterEach(() => vi.unstubAllGlobals());

describe('nimmAnsage', () => {
  it('spielt Beats Player hier: bestätigen und einmischen', async () => {
    const player = { name: 'Yapaia Browser', hoertHier: () => true, sprich: vi.fn(async () => true) };
    vi.stubGlobal('window', { ...globalThis, top: { YapaiaBeatMa: player }, location: { origin: 'http://ha:8123' } });
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    nimmAnsage({ id: 'a1', pfad: '/api/tts_proxy/x.mp3' });
    expect(player.sprich).toHaveBeenCalledWith('http://ha:8123/api/tts_proxy/x.mp3');
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ id: 'a1', ok: true });
  });

  it('spielt hier nichts: nicht bestätigen (dann mischt Beat)', () => {
    const player = { name: 'Yapaia Browser', hoertHier: () => false, sprich: vi.fn(async () => true) };
    vi.stubGlobal('window', { ...globalThis, top: { YapaiaBeatMa: player } });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    nimmAnsage({ id: 'a1', pfad: '/p.mp3' });
    expect(fetch).not.toHaveBeenCalled();
    expect(player.sprich).not.toHaveBeenCalled();
  });
});
