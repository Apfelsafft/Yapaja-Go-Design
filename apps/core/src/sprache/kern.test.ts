import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registriereSprache } from './kern.js';
import type { Sprachdialog } from './dialog.js';

async function app(browser: (t: string, p: string) => Promise<{ pfad: string } | null>) {
  const f = Fastify();
  const ziel = { sage: vi.fn(async () => true) };
  registriereSprache(f, {} as Sprachdialog, ziel, browser);
  await f.ready();
  return { f, ziel };
}

describe('POST /api/v1/ansage', () => {
  it('ist der Browser der Player des Radios, bekommt er die Sprache zum Einmischen', async () => {
    const browser = vi.fn(async () => ({ pfad: '/api/tts_proxy/a.mp3' }));
    const { f, ziel } = await app(browser);
    const r = await f.inject({
      method: 'POST',
      url: '/api/v1/ansage',
      payload: { text: 'Jetzt links', prioritaet: 'navigation', browser_player: 'Yapaia iPad' },
    });
    expect(r.json()).toEqual({ data: { ueber_radio: false, im_browser: { pfad: '/api/tts_proxy/a.mp3' } } });
    expect(browser).toHaveBeenCalledWith('Jetzt links', 'Yapaia iPad');
    expect(ziel.sage).not.toHaveBeenCalled();
  });

  it('sonst (oder ohne browser_player) wie bisher über Beat', async () => {
    const browser = vi.fn(async () => null);
    const { f, ziel } = await app(browser);
    const r = await f.inject({
      method: 'POST',
      url: '/api/v1/ansage',
      payload: { text: 'X', browser_player: 'Yapaia iPad' },
    });
    expect(r.json()).toEqual({ data: { ueber_radio: true } });
    expect(ziel.sage).toHaveBeenCalledWith('X', 'hinweis');
    await f.inject({ method: 'POST', url: '/api/v1/ansage', payload: { text: 'Y' } });
    expect(browser).toHaveBeenCalledTimes(1);
  });
});
